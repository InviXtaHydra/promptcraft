import { rejected } from "../errors";
import type { PrismaClient } from "../prisma-client";
import { loadContent } from "./context";

export const DEFAULT_SCENARIO = "neon-babylon-2099";
const MAX_ACTIVE_SESSIONS = 5;

/** Starts a new investigation on the latest published version of a scenario. */
export async function createGameSession(prisma: PrismaClient, userId: string, scenarioSlug = DEFAULT_SCENARIO) {
  const version = await prisma.scenarioVersion.findFirst({
    where: { scenario: { slug: scenarioSlug }, status: "PUBLISHED" },
    orderBy: { version: "desc" },
  });
  if (!version) throw rejected("no_scenario", "No published scenario yet. Run `npx prisma db seed` first.");
  const content = await loadContent(prisma, version.id);
  const start = [...content.locations.values()].find((l) => l.isStartingPoint)!;

  return prisma.$transaction(async (tx) => {
    const active = await tx.gameSession.count({ where: { userId, status: "ACTIVE" } });
    if (active >= MAX_ACTIVE_SESSIONS) throw rejected("too_many_sessions", `You can have at most ${MAX_ACTIVE_SESSIONS} open investigations`);

    const session = await tx.gameSession.create({ data: { userId, scenarioVersionId: version.id } });
    await tx.worldState.create({ data: { gameSessionId: session.id, credits: content.startingCredits, currentLocationId: start.id } });
    await tx.locationAccess.createMany({
      data: [...content.locations.values()]
        .filter((l) => l.startsUnlocked)
        .map((l) => ({ gameSessionId: session.id, locationId: l.id, visitedAt: l.id === start.id ? new Date() : null })),
    });
    await tx.nPCRelationship.createMany({
      data: [...content.npcs.values()].map((n) => ({ gameSessionId: session.id, npcId: n.id, trust: n.baseTrust, suspicion: n.baseSuspicion })),
    });
    await tx.factionReputation.createMany({ data: [...content.factions.values()].map((f) => ({ gameSessionId: session.id, factionId: f.id, reputation: 0 })) });
    await tx.inventoryItem.createMany({
      data: content.startingItems.map((i) => ({ gameSessionId: session.id, itemDefinitionId: content.items.get(i.itemKey)!.id, quantity: i.quantity, source: "start" })),
    });
    await tx.worldEvent.create({
      data: {
        gameSessionId: session.id,
        key: "investigation-opened",
        title: "Investigation opened",
        description: `You arrive in ${start.name}. Rain, neon, and a fixer who needs a favour.`,
        severity: "INFO",
        actor: "SYSTEM",
        turn: 0,
      },
    });
    await tx.auditLog.create({ data: { userId, action: "game_session.create", targetType: "GameSession", targetId: session.id } });
    return session;
  });
}

export async function listGameSessions(prisma: PrismaClient, userId: string) {
  const sessions = await prisma.gameSession.findMany({
    where: { userId },
    orderBy: { lastPlayedAt: "desc" },
    include: {
      scenarioVersion: { include: { scenario: true } },
      worldState: { include: { currentLocation: true } },
      questStates: { include: { quest: true } },
    },
  });
  return sessions.map((s) => ({
    id: s.id,
    status: s.status,
    title: s.scenarioVersion.scenario.title,
    lastPlayedAt: s.lastPlayedAt.toISOString(),
    createdAt: s.createdAt.toISOString(),
    credits: s.worldState?.credits ?? 0,
    location: s.worldState?.currentLocation.name ?? "",
    questsCompleted: s.questStates.filter((q) => q.status === "COMPLETED").length,
    activeQuest: s.questStates.find((q) => q.status === "ACTIVE")?.quest.title ?? null,
  }));
}
