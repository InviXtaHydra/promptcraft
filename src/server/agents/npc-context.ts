import type { DialogueContext, Persona } from "../dialogue/types";
import { priceFor } from "../engine/commands";
import { objectiveId, type SessionContext } from "../engine/context";
import type { PrismaClient } from "../prisma-client";
import type { NpcContext } from "./brain";
import type { RetrievedMemory } from "./memory";
import { storyHooks } from "./story-hooks";
import type { ToolName } from "./tool-names";

/**
 * Builds what one NPC may know for one turn. Facts are limited to this player's state as it
 * concerns this NPC; secrets appear only above their trust threshold.
 */
export async function buildNpcContext(
  prisma: PrismaClient,
  ctx: SessionContext,
  npcKey: string,
  message: string,
  memories: RetrievedMemory[],
): Promise<NpcContext> {
  const npc = ctx.content.npcs.get(npcKey)!;
  const persona = npc.persona as Persona;
  const rel = ctx.state.relationships.get(npc.key)!;
  const conversation = await prisma.conversation.findUnique({
    where: { gameSessionId_npcId: { gameSessionId: ctx.sessionId, npcId: npc.id } },
    include: { messages: { where: { role: { in: ["PLAYER", "NPC"] } }, orderBy: { createdAt: "desc" }, take: 12 } },
  });
  const history = (conversation?.messages ?? []).reverse().map((m) => ({ role: m.role as "PLAYER" | "NPC", content: m.content }));
  // The message being answered is stored before the turn runs; it isn't history yet
  if (history.at(-1)?.role === "PLAYER" && history.at(-1)?.content === message) history.pop();

  const offers = new Map(npc.offers.map((o) => [o.itemDefinition.key, { name: o.itemDefinition.name, ...priceFor(ctx, o, npc.key) }]));
  const dialogue: DialogueContext = {
    npc: { key: npc.key, name: npc.name, persona },
    message,
    previousPlayerMessages: history.filter((h) => h.role === "PLAYER").length,
    trust: rel.trust,
    suspicion: rel.suspicion,
    alert: ctx.state.alert,
    locationKey: ctx.state.currentLocationKey,
    questStatus: ctx.state.questStatus,
    objectivesDone: ctx.state.objectivesDone,
    evidence: ctx.state.evidence,
    inventory: new Set(ctx.state.inventory.keys()),
    memories: memories.map((m) => m.content),
    offers,
  };

  const here = ctx.content.locations.get(ctx.state.currentLocationKey)!;
  const facts: string[] = [];
  facts.push(npc.location.key === here.key ? `You are at ${here.name}, talking face to face.` : `The player reaches you through a relay from ${here.name}; you are at ${npc.location.name}.`);
  facts.push(dialogue.previousPlayerMessages === 0 ? "This is the first time the player talks to you in this investigation." : `You have talked with the player before (${dialogue.previousPlayerMessages} messages).`);
  for (const quest of ctx.content.quests.values()) {
    const status = ctx.state.questStatus.get(quest.key);
    if (!status || (quest.giver?.key !== npc.key && !quest.objectives.some((o) => o.recipientKey === npc.key || o.targetKey === npc.key))) continue;
    const open = quest.objectives.filter((o) => !ctx.state.objectivesDone.has(objectiveId(quest.key, o.key))).map((o) => `${o.description} [objectiveKey: ${o.key}]`);
    facts.push(`Job "${quest.title}" [questKey: ${quest.key}]: ${status === "COMPLETED" ? "done" : `in progress; still open: ${open.join(" ") || "nothing"}`}`);
  }
  const carried = [...ctx.state.inventory.keys()].map((k) => `${ctx.content.items.get(k)!.name} [itemKey: ${k}]`);
  facts.push(`The player carries: ${carried.join(", ") || "nothing of note"}. They have nothing else.`);
  const evidence = [...ctx.state.evidence].map((k) => ctx.content.evidence.get(k)!);
  facts.push(evidence.length ? `Evidence the player has found: ${evidence.map((e) => `${e.title} [evidenceKey: ${e.key}] (${e.description})`).join(" | ")}` : "The player hasn't found any evidence yet.");
  if (offers.size) facts.push(`You sell: ${[...offers.values()].map((o) => `${o.name} for ${o.price} credits${o.discounted ? " (friend price)" : ""}`).join(", ")}. The player pays at your stall, not through conversation.`);
  const limit = persona.trustThresholds.refuseTradeAtAlert;
  if (limit !== undefined && ctx.state.alert >= limit) facts.push(`The security alert is ${ctx.state.alert}: you refuse to trade until it drops.`);

  const hooks = storyHooks(ctx, npc.key, message);
  return {
    npc: { key: npc.key, name: npc.name, title: npc.title, persona, faction: npc.faction?.name ?? null },
    dialogue,
    revealedSecrets: persona.secrets.filter((s) => rel.trust >= s.revealAtTrust).map((s) => s.fact),
    stateFacts: facts,
    history,
    memories,
    allowedTools: npc.allowedTools as ToolName[],
    hints: hooks.hints,
  };
}
