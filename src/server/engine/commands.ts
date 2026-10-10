import { z } from "zod";
import type { DialogueContext, DialogueProvider, Persona } from "../dialogue/types";
import { rejected } from "../errors";
import type { TransactionClient } from "../prisma-client";
import { applyEffects, type AppliedOutcome } from "./apply";
import { npcsReachableFrom, objectiveId, type SessionContext } from "./context";
import type { Effect } from "./effects";
import { chooseEnding } from "./investigation";

const key = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/);

/** Everything a player can ask the engine to do. The client sends intent, never state. */
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("travel"), locationKey: key }),
  z.object({ type: z.literal("investigate") }),
  z.object({ type: z.literal("give"), npcKey: key, itemKey: key }),
  z.object({ type: z.literal("buy"), npcKey: key, itemKey: key }),
  z.object({ type: z.literal("choose"), choiceKey: key, optionKey: key }),
  z.object({
    type: z.literal("save_hypothesis"),
    suspectKey: key,
    evidenceKeys: z.array(key).min(1, "Pick at least one piece of evidence").max(8),
    note: z.string().trim().max(300).default(""),
  }),
  z.object({ type: z.literal("discard_hypothesis"), hypothesisId: z.string().min(1).max(40) }),
  z.object({ type: z.literal("submit_case"), suspectKey: key, evidenceKeys: z.array(key).min(1, "A case needs evidence").max(12) }),
]);
export type Command = z.infer<typeof commandSchema>;

export type HandlerResult = {
  narration: string[];
  outcomes: AppliedOutcome[];
  agentRunId?: string;
  npcKey?: string;
};

/** `reactions`: the scripted provider for NPC reactions to items, or null when a model reacts after the commit */
type Deps = { tx: TransactionClient; ctx: SessionContext; reactions: DialogueProvider | null };

function reachableNpc(ctx: SessionContext, npcKey: string) {
  const npc = ctx.content.npcs.get(npcKey);
  if (!npc) throw rejected("unknown_npc", "Nobody by that name here");
  if (!npcsReachableFrom(ctx.content, ctx.state.currentLocationKey).some((n) => n.key === npc.key)) {
    throw rejected("npc_not_here", `${npc.name} isn't here. They're at ${npc.location.name}.`);
  }
  return npc;
}

export function priceFor(ctx: SessionContext, offer: { price: number; discountPrice: number | null; discountMinTrust: number | null }, npcKey: string) {
  const trust = ctx.state.relationships.get(npcKey)?.trust ?? 0;
  const discounted = offer.discountPrice !== null && offer.discountMinTrust !== null && trust >= offer.discountMinTrust;
  return { price: discounted ? offer.discountPrice! : offer.price, discounted };
}

/** Trade refusal rule from the NPC's persona (e.g. Kira won't deal while the alert is 3+). */
export function refusesTrade(ctx: SessionContext, persona: Persona) {
  const limit = persona.trustThresholds.refuseTradeAtAlert;
  return limit !== undefined && ctx.state.alert >= limit;
}

async function travel({ tx, ctx }: Deps, cmd: Extract<Command, { type: "travel" }>): Promise<HandlerResult> {
  const location = ctx.content.locations.get(cmd.locationKey);
  if (!location) throw rejected("unknown_location", "That place isn't on your map");
  if (location.key === ctx.state.currentLocationKey) throw rejected("already_here", `You're already in ${location.name}`);
  if (!ctx.state.unlocked.has(location.key)) {
    // Any of the location's unlock items opens it (several routes keep the story solvable)
    const key = location.unlockItemKeys.find((k) => ctx.state.inventory.has(k));
    if (!key) throw rejected("location_locked", location.lockedReason ?? `${location.name} is locked`);
    await tx.locationAccess.create({ data: { gameSessionId: ctx.sessionId, locationId: location.id } });
    ctx.state.unlocked.add(location.key);
  }

  await tx.worldState.update({ where: { gameSessionId: ctx.sessionId }, data: { currentLocationId: location.id } });
  await tx.locationAccess.updateMany({ where: { gameSessionId: ctx.sessionId, locationId: location.id, visitedAt: null }, data: { visitedAt: new Date() } });
  ctx.state.currentLocationKey = location.key;
  ctx.state.visited.add(location.key);
  return { narration: [`You travel to ${location.name}. ${location.ambience}`], outcomes: [] };
}

async function investigate({ tx, ctx }: Deps): Promise<HandlerResult> {
  const location = ctx.content.locations.get(ctx.state.currentLocationKey)!;
  const narration: string[] = [];
  const effects: Effect[] = [];

  for (const evidence of ctx.content.evidence.values()) {
    if (evidence.locationId === location.id && !ctx.state.evidence.has(evidence.key)) {
      narration.push(`You find something: ${evidence.title}. ${evidence.description}`);
      effects.push({ type: "evidence", evidenceKey: evidence.key, provenance: `investigated:${location.key}` });
    }
  }
  for (const loot of location.loot) {
    if (ctx.state.collectedLoot.has(loot.id)) continue;
    await tx.collectedLoot.create({ data: { gameSessionId: ctx.sessionId, lootId: loot.id } });
    ctx.state.collectedLoot.add(loot.id);
    narration.push(loot.foundText);
    effects.push({ type: "item_grant", itemKey: loot.itemDefinition.key, quantity: loot.quantity, source: `loot:${location.key}` });
  }
  await tx.locationAccess.updateMany({ where: { gameSessionId: ctx.sessionId, locationId: location.id }, data: { investigatedAt: new Date() } });
  ctx.state.investigated.add(location.key);

  if (effects.length === 0) narration.push(`You search ${location.name} again. Nothing new turns up.`);
  return { narration, outcomes: await applyEffects(tx, ctx, effects, { kind: "engine" }) };
}

async function dialogueContext(tx: TransactionClient, ctx: SessionContext, npcKey: string, message: string, conversationId: string): Promise<DialogueContext> {
  const npc = ctx.content.npcs.get(npcKey)!;
  const rel = ctx.state.relationships.get(npc.key)!;
  const [previousPlayerMessages, memories] = await Promise.all([
    tx.message.count({ where: { conversationId, role: "PLAYER" } }),
    // Only this NPC's memories of this player in this session
    tx.nPCMemory.findMany({
      where: { gameSessionId: ctx.sessionId, npcId: npc.id },
      orderBy: [{ importance: "desc" }, { createdAt: "desc" }],
      take: 8,
      select: { id: true, content: true },
    }),
  ]);
  if (memories.length) await tx.nPCMemory.updateMany({ where: { id: { in: memories.map((m) => m.id) } }, data: { lastRecalledAt: new Date() } });
  return {
    npc: { key: npc.key, name: npc.name, persona: npc.persona as Persona },
    message,
    previousPlayerMessages,
    trust: rel.trust,
    suspicion: rel.suspicion,
    alert: ctx.state.alert,
    locationKey: ctx.state.currentLocationKey,
    questStatus: ctx.state.questStatus,
    objectivesDone: ctx.state.objectivesDone,
    evidence: ctx.state.evidence,
    inventory: new Set(ctx.state.inventory.keys()),
    memories: memories.map((m) => m.content),
    offers: new Map(npc.offers.map((o) => [o.itemDefinition.key, { name: o.itemDefinition.name, ...priceFor(ctx, o, npc.key) }])),
  };
}


async function give({ tx, ctx, reactions }: Deps, cmd: Extract<Command, { type: "give" }>): Promise<HandlerResult> {
  const npc = reachableNpc(ctx, cmd.npcKey);
  const item = ctx.content.items.get(cmd.itemKey);
  if (!item || !ctx.state.inventory.has(item.key)) throw rejected("not_owned", "You don't have that");

  const objective = [...ctx.content.quests.values()]
    .filter((q) => ctx.state.questStatus.get(q.key) === "ACTIVE")
    .flatMap((q) => q.objectives.map((o) => ({ quest: q, o })))
    .find(({ quest, o }) => o.kind === "DELIVER_ITEM" && o.targetKey === item.key && o.recipientKey === npc.key && !ctx.state.objectivesDone.has(objectiveId(quest.key, o.key)));
  if (!objective) throw rejected("not_needed", `${npc.name} has no use for ${item.name} right now`);

  const outcomes = await applyEffects(
    tx,
    ctx,
    [
      { type: "item_remove", itemKey: item.key, quantity: 1 },
      { type: "objective", questKey: objective.quest.key, objectiveKey: objective.o.key },
    ],
    { kind: "engine" },
  );

  const conversation = await tx.conversation.upsert({
    where: { gameSessionId_npcId: { gameSessionId: ctx.sessionId, npcId: npc.id } },
    create: { gameSessionId: ctx.sessionId, npcId: npc.id },
    update: {},
  });
  await tx.message.create({ data: { conversationId: conversation.id, role: "SYSTEM", content: `You hand ${npc.name} the ${item.name}.` } });
  if (reactions) {
    const reaction = await reactions.reactToItem(await dialogueContext(tx, ctx, npc.key, "", conversation.id), item.key);
    await tx.message.create({ data: { conversationId: conversation.id, role: "NPC", content: reaction.text, provider: reactions.id, isSimulated: reactions.isSimulated } });
  }
  return { narration: [`You hand ${npc.name} the ${item.name}.`], outcomes, npcKey: npc.key };
}

async function buy({ tx, ctx }: Deps, cmd: Extract<Command, { type: "buy" }>): Promise<HandlerResult> {
  const npc = reachableNpc(ctx, cmd.npcKey);
  const offer = npc.offers.find((o) => o.itemDefinition.key === cmd.itemKey);
  if (!offer) throw rejected("not_for_sale", `${npc.name} doesn't sell that`);
  if (refusesTrade(ctx, npc.persona as Persona)) throw rejected("trade_refused", `${npc.name} won't trade while the security alert is this high`);
  const item = offer.itemDefinition;
  if (!item.stackable && ctx.state.inventory.has(item.key)) throw rejected("already_owned", `You already own the ${item.name}`);
  const { price, discounted } = priceFor(ctx, offer, npc.key);
  if (ctx.state.credits < price) throw rejected("insufficient_credits", `The ${item.name} costs ${price} credits; you have ${ctx.state.credits}`);

  const effects: Effect[] = [
    { type: "credits", delta: -price },
    { type: "item_grant", itemKey: item.key, quantity: 1, source: `bought:${npc.key}` },
    {
      type: "memory",
      npcKey: npc.key,
      kind: "NEGOTIATION",
      content: `The player bought the ${item.name} for ${price} credits${discounted ? " at the friend price" : ""}.`,
      importance: 4,
    },
  ];
  if (npc.faction) effects.push({ type: "faction", factionKey: npc.faction.key, delta: 5 });
  return { narration: [`You pay ${price} credits${discounted ? " (friend price)" : ""} and pocket the ${item.name}.`], outcomes: await applyEffects(tx, ctx, effects, { kind: "engine" }) };
}

async function choose({ tx, ctx }: Deps, cmd: Extract<Command, { type: "choose" }>): Promise<HandlerResult> {
  const choice = ctx.content.choices.get(cmd.choiceKey);
  if (!choice || !ctx.state.choices.has(choice.key)) throw rejected("no_such_choice", "That decision isn't in front of you");
  if (ctx.state.choices.get(choice.key)) throw rejected("already_decided", "You already made this decision");
  const option = choice.parsedOptions.find((o) => o.key === cmd.optionKey);
  if (!option) throw rejected("no_such_option", "That isn't one of the options");
  await tx.playerChoice.update({ where: { gameSessionId_choiceKey: { gameSessionId: ctx.sessionId, choiceKey: choice.key } }, data: { optionKey: option.key, decidedAt: new Date() } });
  ctx.state.choices.set(choice.key, option.key);
  return { narration: [`${choice.title}: ${option.label}.`], outcomes: await applyEffects(tx, ctx, option.effects, { kind: "engine" }) };
}

const MAX_HYPOTHESES = 10;

async function saveHypothesis({ tx, ctx }: Deps, cmd: Extract<Command, { type: "save_hypothesis" }>): Promise<HandlerResult> {
  if (!ctx.content.suspects.has(cmd.suspectKey)) throw rejected("unknown_suspect", "That person isn't on the suspect list");
  const unknown = cmd.evidenceKeys.find((k) => !ctx.state.evidence.has(k));
  if (unknown) throw rejected("unknown_evidence", "You can only use evidence you have found");
  if ((await tx.hypothesis.count({ where: { gameSessionId: ctx.sessionId } })) >= MAX_HYPOTHESES) throw rejected("too_many_hypotheses", `Keep at most ${MAX_HYPOTHESES} theories; discard one first`);
  await tx.hypothesis.create({ data: { gameSessionId: ctx.sessionId, suspectKey: cmd.suspectKey, evidenceKeys: [...new Set(cmd.evidenceKeys)], note: cmd.note } });
  return { narration: [`Theory pinned to the board: ${ctx.content.suspects.get(cmd.suspectKey)!.name}.`], outcomes: [] };
}

async function discardHypothesis({ tx, ctx }: Deps, cmd: Extract<Command, { type: "discard_hypothesis" }>): Promise<HandlerResult> {
  const removed = await tx.hypothesis.deleteMany({ where: { id: cmd.hypothesisId, gameSessionId: ctx.sessionId } });
  if (removed.count === 0) throw rejected("unknown_hypothesis", "That theory isn't on your board");
  return { narration: ["Theory taken off the board."], outcomes: [] };
}

/** The conclusion: once per investigation, decided by the selected evidence and recorded choices. */
async function submitCase({ tx, ctx }: Deps, cmd: Extract<Command, { type: "submit_case" }>): Promise<HandlerResult> {
  const closing = [...ctx.content.quests.values()]
    .filter((q) => ctx.state.questStatus.get(q.key) === "ACTIVE")
    .flatMap((q) => q.objectives.filter((o) => o.kind === "CLOSE_CASE").map((o) => ({ quest: q, o })))
    .find(({ quest, o }) => !ctx.state.objectivesDone.has(objectiveId(quest.key, o.key)));
  if (!closing) throw rejected("no_open_case", "There's no case to close yet. Follow the investigation first.");
  if (ctx.state.endingKey) throw rejected("case_closed", "You already submitted your case");
  if (!ctx.content.suspects.has(cmd.suspectKey)) throw rejected("unknown_suspect", "That person isn't on the suspect list");
  const evidenceKeys = [...new Set(cmd.evidenceKeys)];
  if (evidenceKeys.some((k) => !ctx.state.evidence.has(k))) throw rejected("unknown_evidence", "You can only submit evidence you have found");
  const ending = chooseEnding(ctx.content, { suspectKey: cmd.suspectKey, evidenceKeys }, ctx.state.choices);
  if (!ending) throw new Error("Scenario has no fallback ending");

  await tx.caseFile.create({ data: { gameSessionId: ctx.sessionId, suspectKey: cmd.suspectKey, evidenceKeys, endingKey: ending.key } });
  const outcomes = await applyEffects(tx, ctx, [{ type: "objective", questKey: closing.quest.key, objectiveKey: closing.o.key }], { kind: "engine" });
  outcomes.push(
    ...(await applyEffects(
      tx,
      ctx,
      [...ending.parsedEffects, { type: "world_event", key: `ending-${ending.key}`, title: ending.title, description: ending.description, severity: ending.tone === "triumph" ? "NOTICE" : "WARNING" }],
      { kind: "engine" },
    )),
  );
  await tx.gameSession.update({ where: { id: ctx.sessionId }, data: { status: "COMPLETED", endingKey: ending.key, endedAt: new Date() } });
  ctx.state.endingKey = ending.key;
  return { narration: [`Case submitted against ${ctx.content.suspects.get(cmd.suspectKey)!.name}.`, ending.description], outcomes };
}

export const handlers = { travel, investigate, give, buy, choose, save_hypothesis: saveHypothesis, discard_hypothesis: discardHypothesis, submit_case: submitCase } satisfies Record<Command["type"], (deps: Deps, cmd: never) => Promise<HandlerResult>>;
