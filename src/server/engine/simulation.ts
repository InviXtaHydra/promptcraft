import type { Prisma } from "@/generated/prisma/client";
import { notFound, rejected } from "../errors";
import type { PrismaClient, TransactionClient } from "../prisma-client";
import { applyEffects, type AppliedOutcome } from "./apply";
import { allHold, type ConditionState } from "./conditions";
import { loadSessionContext, type SessionContext } from "./context";
import type { Effect } from "./effects";
import { checkProposals } from "./policy";
import { evaluateQuests } from "./quests";

/**
 * The living city: NPCs and factions act on their own between the player's moves.
 *
 * A tick runs in one transaction with the session's row lock. Intentions (scenario data) whose
 * conditions hold are tried in order, at most `maxActionsPerTick` per tick and one per actor. Each
 * action passes the actor's permissions (the same NPC policy as dialogue, or the faction rules),
 * goes through `applyEffects`, and is recorded as a world event. Ticks are idempotent by key and
 * deterministic: no model calls, so the city can't loop or run up a bill.
 */

export type TickAction = {
  intention: string;
  actor: string;
  title: string;
  status: "executed" | "rejected" | "skipped";
  reason?: string;
  outcomes: { status: string; text: string }[];
};
export type TickResult = { tick: number; trigger: "TURN" | "MANUAL" | "SCHEDULE"; actions: TickAction[]; replayed: boolean; skipped?: string };

/** Factions don't have tool permissions; they may spread word (events) and move reputations a little. */
function checkFactionEffects(ctx: SessionContext, effects: Effect[]) {
  for (const e of effects) {
    if (e.type === "world_event") continue;
    if (e.type === "faction" && ctx.content.factions.has(e.factionKey) && Math.abs(e.delta) <= 10) continue;
    return `a faction can only spread word and shift reputations by up to 10 (not ${e.type})`;
  }
  return null;
}

const asConditionState = (ctx: SessionContext, tick: number): ConditionState => ({ ...ctx.state, tick });

async function tickInTransaction(tx: TransactionClient, sessionId: string, userId: string, trigger: TickResult["trigger"], idempotencyKey: string): Promise<TickResult> {
  const session = await tx.gameSession.findFirst({ where: { id: sessionId, userId }, select: { id: true, status: true } });
  if (!session) throw notFound("Game session");
  await tx.$queryRaw`SELECT 1 FROM "WorldState" WHERE "gameSessionId" = ${sessionId} FOR UPDATE`;

  const previous = await tx.simulationTick.findUnique({ where: { gameSessionId_idempotencyKey: { gameSessionId: sessionId, idempotencyKey } } });
  if (previous) return { tick: previous.tick, trigger: previous.trigger, actions: previous.actions as TickAction[], replayed: true };

  const sim = await tx.simulationState.upsert({ where: { gameSessionId: sessionId }, create: { gameSessionId: sessionId }, update: {} });
  if (session.status !== "ACTIVE") return { tick: sim.tick, trigger, actions: [], replayed: false, skipped: "the investigation is closed" };
  if (sim.paused && trigger !== "MANUAL") return { tick: sim.tick, trigger, actions: [], replayed: false, skipped: "the simulation is paused" };

  const started = Date.now();
  const tick = sim.tick + 1;
  const ctx = await loadSessionContext(tx, sessionId, userId);
  ctx.state.tick = tick;
  const budget = ctx.content.simulation.maxActionsPerTick;
  const runs = await tx.intentionRun.findMany({ where: { gameSessionId: sessionId }, orderBy: { tick: "desc" } });
  const lastRun = new Map<string, number>();
  for (const r of runs) if (!lastRun.has(r.intentionId)) lastRun.set(r.intentionId, r.tick);

  const actions: TickAction[] = [];
  const actedThisTick = new Set<string>();
  let executed = 0;

  for (const intention of ctx.content.intentions) {
    const actor = `${intention.actorType}:${intention.actorKey}`;
    const ran = lastRun.get(intention.id);
    if (intention.once && ran !== undefined) continue;
    if (ran !== undefined && tick - ran <= intention.cooldownTicks) continue;
    if (!allHold(intention.parsedConditions, asConditionState(ctx, tick))) continue;

    const base = { intention: intention.key, actor, title: intention.title };
    if (executed >= budget) {
      actions.push({ ...base, status: "skipped", reason: `tick budget of ${budget} actions used`, outcomes: [] });
      continue;
    }
    if (actedThisTick.has(actor)) {
      actions.push({ ...base, status: "skipped", reason: "this actor already acted this tick", outcomes: [] });
      continue;
    }

    let outcomes: AppliedOutcome[];
    if (intention.actorType === "npc") {
      const verdicts = checkProposals(ctx, intention.actorKey, intention.parsedEffects);
      const refused = verdicts.find((v) => !v.ok);
      if (refused && !refused.ok) {
        actions.push({ ...base, status: "rejected", reason: `policy: ${refused.reason}`, outcomes: [] });
        continue;
      }
      outcomes = await applyEffects(tx, ctx, intention.parsedEffects, { kind: "npc", npcKey: intention.actorKey });
    } else {
      const refused = checkFactionEffects(ctx, intention.parsedEffects);
      if (refused) {
        actions.push({ ...base, status: "rejected", reason: refused, outcomes: [] });
        continue;
      }
      outcomes = await applyEffects(tx, ctx, intention.parsedEffects, { kind: "engine" });
    }
    if (!outcomes.some((o) => o.status === "applied")) {
      // Nothing could change (e.g. already at the limit): don't spend the budget or the "once"
      actions.push({ ...base, status: "skipped", reason: "no effect on the current state", outcomes: outcomes.map((o) => ({ status: o.status, text: o.status === "applied" ? (o.text ?? "") : o.reason })) });
      continue;
    }
    const npcId = intention.actorType === "npc" ? ctx.content.npcs.get(intention.actorKey)?.id : undefined;
    await tx.worldEvent.create({
      data: {
        gameSessionId: sessionId,
        key: intention.once ? `intention-${intention.key}` : `intention-${intention.key}-${tick}`,
        title: intention.title,
        description: intention.description,
        severity: intention.parsedEffects.some((e) => e.type === "alert" || e.type === "offer_choice") ? "WARNING" : "NOTICE",
        actor: intention.actorType === "npc" ? "NPC" : "SYSTEM",
        actorNpcId: npcId ?? null,
        turn: ctx.state.turn,
      },
    });
    await tx.intentionRun.create({ data: { gameSessionId: sessionId, intentionId: intention.id, tick } });
    actions.push({ ...base, status: "executed", outcomes: outcomes.map((o) => ({ status: o.status, text: o.status === "applied" ? (o.text ?? "") : o.reason })) });
    actedThisTick.add(actor);
    executed++;
  }

  const questOutcomes = await evaluateQuests(tx, ctx);
  if (questOutcomes.length) {
    actions.push({ intention: "quests", actor: "engine", title: "Quest progress", status: "executed", outcomes: questOutcomes.map((o) => ({ status: o.status, text: o.status === "applied" ? (o.text ?? "") : o.reason })) });
  }
  await tx.simulationTick.create({ data: { gameSessionId: sessionId, tick, trigger, idempotencyKey, actions: actions as unknown as Prisma.InputJsonValue, durationMs: Date.now() - started } });
  await tx.simulationState.update({ where: { gameSessionId: sessionId }, data: { tick, lastTickAt: new Date() } });
  return { tick, trigger, actions, replayed: false };
}

export function runSimulationTick(prisma: PrismaClient, input: { sessionId: string; userId: string; trigger: TickResult["trigger"]; idempotencyKey: string }) {
  return prisma.$transaction((tx) => tickInTransaction(tx, input.sessionId, input.userId, input.trigger, input.idempotencyKey), { maxWait: 5_000, timeout: 15_000 });
}

/** The automatic tick after every N player turns. Safe to call twice for the same turn. */
export async function autoTick(prisma: PrismaClient, sessionId: string, userId: string, turn: number): Promise<TickResult | null> {
  const version = await prisma.gameSession.findFirst({ where: { id: sessionId, userId }, select: { scenarioVersion: { select: { simulationEveryTurns: true } } } });
  if (!version || turn % version.scenarioVersion.simulationEveryTurns !== 0) return null;
  const result = await runSimulationTick(prisma, { sessionId, userId, trigger: "TURN", idempotencyKey: `turn:${turn}` });
  // Paused, closed, or this turn's tick already ran: nothing new happened
  return result.skipped || result.replayed ? null : result;
}

/** Development controls. Off in production unless the user is a creator or admin. */
export function assertSimulationControls(role: string) {
  if (process.env.NODE_ENV === "production" && role !== "CREATOR" && role !== "ADMIN") {
    throw rejected("dev_only", "Simulation controls are only available in development mode");
  }
}

export async function setPaused(prisma: PrismaClient, sessionId: string, userId: string, paused: boolean) {
  const session = await prisma.gameSession.findFirst({ where: { id: sessionId, userId }, select: { id: true } });
  if (!session) throw notFound("Game session");
  return prisma.simulationState.upsert({ where: { gameSessionId: sessionId }, create: { gameSessionId: sessionId, paused }, update: { paused } });
}

export async function simulationHistory(prisma: PrismaClient, sessionId: string, userId: string) {
  const session = await prisma.gameSession.findFirst({ where: { id: sessionId, userId }, include: { simulation: true, scenarioVersion: true } });
  if (!session) throw notFound("Game session");
  const ticks = await prisma.simulationTick.findMany({ where: { gameSessionId: sessionId }, orderBy: { tick: "desc" }, take: 50 });
  return {
    paused: session.simulation?.paused ?? false,
    tick: session.simulation?.tick ?? 0,
    everyTurns: session.scenarioVersion.simulationEveryTurns,
    maxActionsPerTick: session.scenarioVersion.simulationMaxActions,
    ticks: ticks.map((t) => ({ tick: t.tick, trigger: t.trigger, durationMs: t.durationMs, createdAt: t.createdAt.toISOString(), actions: t.actions as TickAction[] })),
  };
}
