import { describe, expect, it } from "vitest";
import { replayPolicy, sessionMetrics } from "@/server/agents/metrics";
import { runSimulationTick } from "@/server/engine/simulation";
import { GameError } from "@/server/errors";
import { newGame, testPrisma } from "../support/factories";

describe("agent metrics and replay", () => {
  it("summarises runs, tools, retrieval and the simulation from the stored traces", async () => {
    const g = await newGame();
    await g.talk("balthazar", "hello");
    await g.talk("balthazar", "Where should I look?");
    await runSimulationTick(testPrisma, { sessionId: g.session.id, userId: g.user.id, trigger: "MANUAL", idempotencyKey: "t-1" });
    const m = await sessionMetrics(testPrisma, g.session.id, g.user.id);
    expect(m.runs).toMatchObject({ total: 2, simulated: 2, byStatus: { SUCCEEDED: 2, FAILED: 0 } });
    expect(m.latencyMs.measured).toBe(true);
    expect(m.cost).toMatchObject({ estimated: true, usd: 0 });
    expect(m.tools.byTool).toContainEqual({ tool: "update_quest", executed: 1, rejected: 0 });
    expect(m.retrieval.turns).toBe(2);
    expect(m.retrieval.turnsWithMemories).toBeGreaterThanOrEqual(1); // the second turn recalls the first
    expect(m.nodes.map((n) => n.node)).toEqual(expect.arrayContaining(["interpret", "respond", "execute"]));
    expect(m.simulation.ticks).toBe(1);
  });

  it("replays a run's tool calls against today's state without writing anything", async () => {
    const g = await newGame();
    const first = await g.talk("balthazar", "hello");
    const before = await testPrisma.gameEvent.count({ where: { gameSessionId: g.session.id } });
    const replay = await replayPolicy(testPrisma, g.session.id, g.user.id, first.runId);
    expect(replay.dryRun).toBe(true);
    // Then: the quest start was executed. Now: the quest already runs, so the engine would refuse it, but the policy still allows the call
    expect(replay.comparisons).toEqual([expect.objectContaining({ tool: "update_quest", then: expect.objectContaining({ status: "executed" }), now: expect.objectContaining({ status: "approved" }) })]);
    expect(await testPrisma.gameEvent.count({ where: { gameSessionId: g.session.id } })).toBe(before);

    const small = await g.talk("balthazar", "Thanks.");
    expect((await replayPolicy(testPrisma, g.session.id, g.user.id, small.runId)).note).toMatch(/small talk/);
  });

  it("only shows metrics and replays to the owner", async () => {
    const owner = await newGame();
    const r = await owner.talk("balthazar", "hello");
    const other = await newGame();
    await expect(sessionMetrics(testPrisma, owner.session.id, other.user.id)).rejects.toBeInstanceOf(GameError);
    await expect(replayPolicy(testPrisma, owner.session.id, other.user.id, r.runId)).rejects.toBeInstanceOf(GameError);
    await expect(replayPolicy(testPrisma, other.session.id, other.user.id, r.runId)).rejects.toBeInstanceOf(GameError);
  });
});
