import type { Prisma } from "@/generated/prisma/client";
import { notFound } from "../errors";
import type { PrismaClient, TransactionClient } from "../prisma-client";
import { effectListSchema, type Effect } from "./effects";

type Db = PrismaClient | TransactionClient;

/** Scenario content, loaded once per version and cached: versions are immutable. */
export type ScenarioContent = Awaited<ReturnType<typeof loadContentUncached>>;

async function loadContentUncached(db: Db, scenarioVersionId: string) {
  const version = await db.scenarioVersion.findUniqueOrThrow({
    where: { id: scenarioVersionId },
    include: {
      scenario: true,
      locations: { include: { loot: { include: { itemDefinition: true } } }, orderBy: { sortOrder: "asc" } },
      factions: true,
      npcs: { include: { offers: { include: { itemDefinition: true } }, location: true, faction: true } },
      items: true,
      quests: { include: { objectives: { orderBy: { sortOrder: "asc" } }, giver: true }, orderBy: { sortOrder: "asc" } },
      evidence: { include: { location: true } },
    },
  });
  const byKey = <T extends { key: string }>(rows: T[]) => new Map(rows.map((r) => [r.key, r]));
  const parseEffects = (json: Prisma.JsonValue, where: string): Effect[] => {
    const parsed = effectListSchema.safeParse(json);
    if (!parsed.success) throw new Error(`Invalid effects in ${where}: ${parsed.error.message}`);
    return parsed.data;
  };
  const startingItems = (version.startingItems as { itemKey: string; quantity: number }[]) ?? [];
  return {
    id: version.id,
    title: version.scenario.title,
    startingCredits: version.startingCredits,
    startingItems,
    locations: byKey(version.locations),
    locationsById: new Map(version.locations.map((l) => [l.id, l])),
    factions: byKey(version.factions),
    npcs: byKey(version.npcs),
    npcsById: new Map(version.npcs.map((n) => [n.id, n])),
    items: byKey(version.items),
    itemsById: new Map(version.items.map((i) => [i.id, i])),
    quests: byKey(
      version.quests.map((q) => ({
        ...q,
        completionEffects: parseEffects(q.onCompleteEffects, `quest ${q.key}`),
        objectives: q.objectives.map((o) => ({ ...o, completionEffects: parseEffects(o.onCompleteEffects, `objective ${q.key}/${o.key}`) })),
      })),
    ),
    evidence: byKey(version.evidence),
    evidenceById: new Map(version.evidence.map((e) => [e.id, e])),
  };
}

const contentCache = new Map<string, Promise<ScenarioContent>>();
export function loadContent(db: Db, scenarioVersionId: string) {
  let cached = contentCache.get(scenarioVersionId);
  if (!cached) {
    cached = loadContentUncached(db, scenarioVersionId);
    contentCache.set(scenarioVersionId, cached);
    cached.catch(() => contentCache.delete(scenarioVersionId));
  }
  return cached;
}

/**
 * Everything the engine needs to decide a command, as plain data. Effects update this copy as they
 * are applied, so later checks in the same command see earlier changes.
 */
export type PlayerState = {
  credits: number;
  alert: number;
  turn: number;
  currentLocationKey: string;
  inventory: Map<string, number>;
  evidence: Set<string>;
  unlocked: Set<string>;
  visited: Set<string>;
  investigated: Set<string>;
  relationships: Map<string, { trust: number; suspicion: number }>;
  reputations: Map<string, number>;
  questStatus: Map<string, "ACTIVE" | "COMPLETED" | "FAILED">;
  objectivesDone: Set<string>;
  talkedTo: Set<string>;
  worldEventKeys: Set<string>;
  collectedLoot: Set<string>;
};

export type SessionContext = {
  sessionId: string;
  userId: string;
  content: ScenarioContent;
  state: PlayerState;
};

export const objectiveId = (questKey: string, objectiveKey: string) => `${questKey}/${objectiveKey}`;

/**
 * Loads a save game for its owner. A session that belongs to someone else is reported as not found,
 * exactly like one that doesn't exist, so ids can't be probed.
 */
export async function loadSessionContext(db: Db, sessionId: string, userId: string): Promise<SessionContext> {
  const session = await db.gameSession.findFirst({ where: { id: sessionId, userId }, include: { worldState: true } });
  if (!session || !session.worldState) throw notFound("Game session");
  const content = await loadContent(db, session.scenarioVersionId);

  const [access, relationships, reputations, inventory, questStates, objectives, evidence, conversations, events, loot] = await Promise.all([
    db.locationAccess.findMany({ where: { gameSessionId: sessionId } }),
    db.nPCRelationship.findMany({ where: { gameSessionId: sessionId } }),
    db.factionReputation.findMany({ where: { gameSessionId: sessionId } }),
    db.inventoryItem.findMany({ where: { gameSessionId: sessionId } }),
    db.questState.findMany({ where: { gameSessionId: sessionId } }),
    db.objectiveProgress.findMany({ where: { gameSessionId: sessionId }, include: { objective: { include: { quest: true } } } }),
    db.discoveredEvidence.findMany({ where: { gameSessionId: sessionId } }),
    db.conversation.findMany({ where: { gameSessionId: sessionId, messages: { some: { role: "PLAYER" } } } }),
    db.worldEvent.findMany({ where: { gameSessionId: sessionId, key: { not: null } }, select: { key: true } }),
    db.collectedLoot.findMany({ where: { gameSessionId: sessionId } }),
  ]);

  const locationKey = (id: string) => content.locationsById.get(id)!.key;
  const questKey = (id: string) => [...content.quests.values()].find((q) => q.id === id)!.key;

  return {
    sessionId,
    userId,
    content,
    state: {
      credits: session.worldState.credits,
      alert: session.worldState.securityAlert,
      turn: session.worldState.turn,
      currentLocationKey: locationKey(session.worldState.currentLocationId),
      inventory: new Map(inventory.map((i) => [content.itemsById.get(i.itemDefinitionId)!.key, i.quantity])),
      evidence: new Set(evidence.map((e) => content.evidenceById.get(e.evidenceId)!.key)),
      unlocked: new Set(access.map((a) => locationKey(a.locationId))),
      visited: new Set(access.filter((a) => a.visitedAt).map((a) => locationKey(a.locationId))),
      investigated: new Set(access.filter((a) => a.investigatedAt).map((a) => locationKey(a.locationId))),
      relationships: new Map(relationships.map((r) => [content.npcsById.get(r.npcId)!.key, { trust: r.trust, suspicion: r.suspicion }])),
      reputations: new Map(reputations.map((r) => [[...content.factions.values()].find((f) => f.id === r.factionId)!.key, r.reputation])),
      questStatus: new Map(questStates.map((q) => [questKey(q.questId), q.status])),
      objectivesDone: new Set(objectives.map((o) => objectiveId(o.objective.quest.key, o.objective.key))),
      talkedTo: new Set(conversations.map((c) => content.npcsById.get(c.npcId)!.key)),
      worldEventKeys: new Set(events.map((e) => e.key!)),
      collectedLoot: new Set(loot.map((l) => l.lootId)),
    },
  };
}

/** NPCs the player can talk to right now: present at the location, or reachable from it. */
export function npcsReachableFrom(content: ScenarioContent, locationKey: string) {
  return [...content.npcs.values()].filter((n) => n.location.key === locationKey || n.reachableFrom.includes(locationKey));
}
