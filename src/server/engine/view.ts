import type { ConversationView, GameView } from "@/lib/game-types";
import type { DialogueProvider, Persona } from "../dialogue/types";
import { notFound } from "../errors";
import type { PrismaClient } from "../prisma-client";
import { priceFor, refusesTrade } from "./commands";
import { loadSessionContext, npcsReachableFrom, objectiveId } from "./context";

/** The player's view of a save game. Only data this player is allowed to see. */
export async function buildGameView(prisma: PrismaClient, sessionId: string, userId: string, callsign: string): Promise<GameView> {
  const ctx = await loadSessionContext(prisma, sessionId, userId);
  const { content, state } = ctx;
  const [session, inventory, evidence, events] = await Promise.all([
    prisma.gameSession.findUniqueOrThrow({ where: { id: sessionId } }),
    prisma.inventoryItem.findMany({ where: { gameSessionId: sessionId }, orderBy: { acquiredAt: "asc" } }),
    prisma.discoveredEvidence.findMany({ where: { gameSessionId: sessionId }, orderBy: { discoveredAt: "asc" } }),
    prisma.worldEvent.findMany({ where: { gameSessionId: sessionId }, orderBy: { createdAt: "desc" }, take: 25 }),
  ]);
  const here = content.locations.get(state.currentLocationKey)!;

  const pendingDeliveries = [...content.quests.values()]
    .filter((q) => state.questStatus.get(q.key) === "ACTIVE")
    .flatMap((q) => q.objectives.filter((o) => o.kind === "DELIVER_ITEM" && !state.objectivesDone.has(objectiveId(q.key, o.key))));

  return {
    session: { id: session.id, status: session.status, scenarioTitle: content.title, turn: state.turn },
    player: { callsign },
    world: { credits: state.credits, alert: state.alert },
    location: {
      key: here.key,
      name: here.name,
      district: here.district,
      description: here.description,
      ambience: here.ambience,
      accent: here.accent,
      investigated: state.investigated.has(here.key),
    },
    locations: [...content.locations.values()].map((l) => ({
      key: l.key,
      name: l.name,
      district: l.district,
      accent: l.accent,
      unlocked: state.unlocked.has(l.key),
      current: l.key === here.key,
      visited: state.visited.has(l.key),
      lockedReason: state.unlocked.has(l.key) ? null : l.lockedReason,
    })),
    npcsHere: npcsReachableFrom(content, here.key).map((n) => {
      const rel = state.relationships.get(n.key)!;
      const refused = refusesTrade(ctx, n.persona as Persona);
      return {
        key: n.key,
        name: n.name,
        title: n.title,
        shortBio: n.shortBio,
        accent: n.accent,
        trust: rel.trust,
        suspicion: rel.suspicion,
        remote: n.location.key !== here.key,
        faction: n.faction?.name ?? null,
        offers: n.offers.map((o) => ({
          itemKey: o.itemDefinition.key,
          name: o.itemDefinition.name,
          description: o.itemDefinition.description,
          ...priceFor(ctx, o, n.key),
          owned: state.inventory.has(o.itemDefinition.key) && !o.itemDefinition.stackable,
          refused,
        })),
        wants: pendingDeliveries
          .filter((o) => o.recipientKey === n.key && state.inventory.has(o.targetKey))
          .map((o) => ({ itemKey: o.targetKey, name: content.items.get(o.targetKey)!.name })),
      };
    }),
    inventory: inventory.map((i) => {
      const item = content.itemsById.get(i.itemDefinitionId)!;
      return { key: item.key, name: item.name, description: item.description, kind: item.kind, rarity: item.rarity, quantity: i.quantity, source: i.source };
    }),
    quests: [...content.quests.values()]
      .filter((q) => state.questStatus.has(q.key))
      .map((q) => ({
        key: q.key,
        title: q.title,
        summary: q.summary,
        status: state.questStatus.get(q.key)!,
        isMain: q.isMain,
        giver: q.giver?.name ?? null,
        rewardCredits: q.rewardCredits,
        rewardText: q.rewardText,
        objectives: q.objectives.map((o) => ({ key: o.key, description: o.description, optional: o.optional, done: state.objectivesDone.has(objectiveId(q.key, o.key)) })),
      })),
    evidence: evidence.map((d) => {
      const e = content.evidenceById.get(d.evidenceId)!;
      return { key: e.key, title: e.title, description: e.description, reliability: e.reliability, tags: e.tags, provenance: d.provenance, discoveredAt: d.discoveredAt.toISOString() };
    }),
    factions: [...content.factions.values()].map((f) => ({ key: f.key, name: f.name, accent: f.accent, reputation: state.reputations.get(f.key) ?? 0 })),
    events: events.map((e) => ({ id: e.id, title: e.title, description: e.description, severity: e.severity, actor: e.actor, turn: e.turn, createdAt: e.createdAt.toISOString() })),
  };
}

/** The conversation with one NPC in this save game, plus deterministic suggestions for the next line. */
export async function getConversation(prisma: PrismaClient, sessionId: string, userId: string, npcKey: string, provider: DialogueProvider): Promise<ConversationView> {
  const ctx = await loadSessionContext(prisma, sessionId, userId);
  const npc = ctx.content.npcs.get(npcKey);
  if (!npc) throw notFound("NPC");
  const conversation = await prisma.conversation.findUnique({
    where: { gameSessionId_npcId: { gameSessionId: sessionId, npcId: npc.id } },
    include: { messages: { orderBy: { createdAt: "asc" }, take: 200 } },
  });
  const memories = await prisma.nPCMemory.findMany({ where: { gameSessionId: sessionId, npcId: npc.id }, select: { content: true } });
  const rel = ctx.state.relationships.get(npc.key)!;
  const reachable = npcsReachableFrom(ctx.content, ctx.state.currentLocationKey).some((n) => n.key === npc.key);

  return {
    npc: { key: npc.key, name: npc.name, title: npc.title, accent: npc.accent },
    provider: { id: provider.id, model: provider.model, isSimulated: provider.isSimulated },
    reachable,
    messages: (conversation?.messages ?? []).map((m) => ({ id: m.id, role: m.role, content: m.content, isSimulated: m.isSimulated, createdAt: m.createdAt.toISOString() })),
    suggestions: reachable
      ? provider.suggestions({
          npc: { key: npc.key, name: npc.name, persona: npc.persona as Persona },
          previousPlayerMessages: conversation?.messages.filter((m) => m.role === "PLAYER").length ?? 0,
          trust: rel.trust,
          suspicion: rel.suspicion,
          alert: ctx.state.alert,
          locationKey: ctx.state.currentLocationKey,
          questStatus: ctx.state.questStatus,
          objectivesDone: ctx.state.objectivesDone,
          evidence: ctx.state.evidence,
          inventory: new Set(ctx.state.inventory.keys()),
          memories: memories.map((m) => m.content),
          offers: new Map(),
        })
      : [],
  };
}
