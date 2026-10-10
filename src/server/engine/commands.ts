import { z } from "zod";
import type { DialogueContext, DialogueProvider, Persona } from "../dialogue/types";
import { rejected } from "../errors";
import type { TransactionClient } from "../prisma-client";
import { applyEffects, type AppliedOutcome } from "./apply";
import { npcsReachableFrom, objectiveId, type SessionContext } from "./context";
import type { Effect } from "./effects";
import { checkProposals } from "./policy";

const key = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/);

/** Everything a player can ask the engine to do. The client sends intent, never state. */
export const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("travel"), locationKey: key }),
  z.object({ type: z.literal("investigate") }),
  z.object({ type: z.literal("talk"), npcKey: key, message: z.string().trim().min(1, "Say something").max(500, "Keep it under 500 characters") }),
  z.object({ type: z.literal("give"), npcKey: key, itemKey: key }),
  z.object({ type: z.literal("buy"), npcKey: key, itemKey: key }),
]);
export type Command = z.infer<typeof commandSchema>;

export type HandlerResult = {
  narration: string[];
  outcomes: AppliedOutcome[];
  agentRunId?: string;
  npcKey?: string;
};

type Deps = { tx: TransactionClient; ctx: SessionContext; provider: DialogueProvider };

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
  if (!ctx.state.unlocked.has(location.key)) throw rejected("location_locked", location.lockedReason ?? `${location.name} is locked`);

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

/**
 * One NPC turn, recorded as an AgentRun with its steps and proposed effects (tool calls), so the
 * AgentDebugger (Phase 2) can show exactly what was proposed, rejected and executed.
 */
async function talk({ tx, ctx, provider }: Deps, cmd: Extract<Command, { type: "talk" }>): Promise<HandlerResult> {
  const npc = reachableNpc(ctx, cmd.npcKey);
  const started = Date.now();
  const conversation = await tx.conversation.upsert({
    where: { gameSessionId_npcId: { gameSessionId: ctx.sessionId, npcId: npc.id } },
    create: { gameSessionId: ctx.sessionId, npcId: npc.id },
    update: {},
  });
  const run = await tx.agentRun.create({
    data: { gameSessionId: ctx.sessionId, userId: ctx.userId, npcId: npc.id, provider: provider.id, model: provider.model, isSimulated: provider.isSimulated },
  });
  let index = 0;
  let last = Date.now();
  const step = async (node: string, summary: string, data?: object) => {
    const now = Date.now();
    const row = await tx.agentStep.create({ data: { runId: run.id, index: index++, node, status: "SUCCEEDED", summary, data: data ?? undefined, durationMs: now - last } });
    last = now;
    return row.id;
  };

  await tx.message.create({ data: { conversationId: conversation.id, role: "PLAYER", content: cmd.message } });
  await step("validate_request", "Message accepted (1–500 characters, NPC reachable from the current location).");
  const dctx = await dialogueContext(tx, ctx, npc.key, cmd.message, conversation.id);
  await step("load_state", `Loaded state: trust ${dctx.trust}, suspicion ${dctx.suspicion}, alert ${dctx.alert}.`);
  await step("retrieve_memories", `${dctx.memories.length} of ${npc.name}'s memories of this player, by importance.`, { memories: dctx.memories });

  const answer = await provider.reply(dctx);
  await step("interpret", answer.summary, { intent: answer.intent, provider: provider.id, model: provider.model, simulated: provider.isSimulated });

  const checks = checkProposals(ctx, npc.key, answer.proposals);
  const policyStepId = await step(
    "policy_check",
    `${checks.filter((c) => c.ok).length} of ${checks.length} proposed actions allowed for ${npc.name}.`,
    { rejected: checks.filter((c) => !c.ok).map((c) => (c.ok ? null : c.reason)) },
  );

  const outcomes: AppliedOutcome[] = [];
  for (const check of checks) {
    if (!check.ok) {
      await tx.toolExecution.create({
        data: { runId: run.id, stepId: policyStepId, toolName: toolName(check.raw), arguments: (check.raw ?? {}) as object, status: "REJECTED", rejectionReason: check.reason },
      });
      continue;
    }
    const applied = await applyEffects(tx, ctx, [check.effect], { kind: "npc", npcKey: npc.key });
    outcomes.push(...applied);
    const first = applied[0];
    await tx.toolExecution.create({
      data: {
        runId: run.id,
        stepId: policyStepId,
        toolName: check.effect.type,
        arguments: check.effect,
        status: first?.status === "applied" ? "EXECUTED" : "REJECTED",
        result: applied.map((o) => ({ status: o.status, ...(o.status === "applied" ? { text: o.text ?? null } : { reason: o.reason }) })),
        rejectionReason: first?.status === "skipped" ? `engine: ${first.reason}` : null,
      },
    });
  }
  await step("execute", `${outcomes.filter((o) => o.status === "applied").length} state changes applied by the engine.`);

  ctx.state.talkedTo.add(npc.key);
  await tx.message.create({
    data: { conversationId: conversation.id, role: "NPC", content: answer.text, provider: provider.id, isSimulated: provider.isSimulated, agentRunId: run.id },
  });
  await tx.nPCRelationship.update({ where: { gameSessionId_npcId: { gameSessionId: ctx.sessionId, npcId: npc.id } }, data: { lastInteractionAt: new Date() } });
  await step("respond", provider.isSimulated ? "Reply from the deterministic mock script (simulated, not AI-generated)." : "Reply generated.");
  await tx.agentRun.update({ where: { id: run.id }, data: { status: "SUCCEEDED", finishedAt: new Date(), latencyMs: Date.now() - started } });

  return { narration: [], outcomes, agentRunId: run.id, npcKey: npc.key };
}

const toolName = (raw: unknown) => (raw && typeof raw === "object" && "type" in raw && typeof raw.type === "string" ? raw.type.slice(0, 40) : "unknown");

async function give({ tx, ctx, provider }: Deps, cmd: Extract<Command, { type: "give" }>): Promise<HandlerResult> {
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
  const reaction = await provider.reactToItem(await dialogueContext(tx, ctx, npc.key, "", conversation.id), item.key);
  await tx.message.createMany({
    data: [
      { conversationId: conversation.id, role: "SYSTEM", content: `You hand ${npc.name} the ${item.name}.` },
      { conversationId: conversation.id, role: "NPC", content: reaction.text, provider: provider.id, isSimulated: provider.isSimulated },
    ],
  });
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

export const handlers = { travel, investigate, talk, give, buy } satisfies Record<Command["type"], (deps: Deps, cmd: never) => Promise<HandlerResult>>;
