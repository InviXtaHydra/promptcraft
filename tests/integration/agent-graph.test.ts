import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { ProviderError } from "@/server/ai/errors";
import { MockBrain, type NpcContext } from "@/server/agents/brain";
import { getRun, listRuns } from "@/server/agents/runs";
import type { TurnEvent } from "@/server/agents/trace";
import { GameError } from "@/server/errors";
import { buildGameView } from "@/server/engine/view";
import { newGame, testPrisma } from "../support/factories";

const isGameError = (code: string) => (e: unknown) => e instanceof GameError && e.code === code;
const nodesOf = async (runId: string) => (await testPrisma.agentStep.findMany({ where: { runId }, orderBy: { index: "asc" } })).map((s) => s.node);
const turnOf = async (sessionId: string) => (await testPrisma.worldState.findUniqueOrThrow({ where: { gameSessionId: sessionId } })).turn;

/** A brain that proposes whatever the test wants. */
class ScriptedTestBrain extends MockBrain {
  constructor(private readonly calls: { tool: string; args: unknown }[]) {
    super();
  }
  override async interpret(ctx: NpcContext) {
    const r = await super.interpret(ctx);
    return { value: { ...r.value, needsAction: true } };
  }
  override async plan(): Promise<{ value: { toolCalls: { tool: string; args: unknown; source: string }[]; rationale: string } }> {
    return { value: { toolCalls: this.calls.map((c) => ({ ...c, source: "model" })), rationale: "test" } };
  }
}

describe("the NPC turn graph", () => {
  it("skips planning and policy for small talk", async () => {
    const { session, talk } = await newGame();
    await talk("balthazar", "hello"); // first contact starts the quest
    const r = await talk("balthazar", "Thanks, Balthazar.");
    expect(await nodesOf(r.runId)).toEqual(["validate_request", "load_state", "build_npc_context", "retrieve_memories", "interpret", "execute", "respond", "consolidate_memory", "finalize"]);
    expect(r.reply).toMatch(/alley|trail/i); // the active-quest hint
    expect(await turnOf(session.id)).toBe(2);
  });

  it("keeps the game playable when the model proposes nothing: the quest giver's story rule still applies", async () => {
    const silent = new (class extends MockBrain {
      override async interpret(ctx: NpcContext) {
        const r = await super.interpret(ctx);
        return { value: { ...r.value, needsAction: false } };
      }
    })();
    const { user, session, talk } = await newGame({ brain: silent });
    const r = await talk("balthazar", "...");
    expect(await nodesOf(r.runId)).toContain("policy_check");
    expect(await nodesOf(r.runId)).not.toContain("plan");
    const tools = await testPrisma.toolExecution.findMany({ where: { runId: r.runId } });
    expect(tools.map((t) => [t.toolName, t.status])).toEqual([["update_quest", "EXECUTED"]]);
    expect((await buildGameView(testPrisma, session.id, user.id, "t")).quests[0]?.key).toBe("ghost-courier");
  });

  it("streams events in order: run_started, nodes, reply deltas, done", async () => {
    const { talk } = await newGame();
    const events: TurnEvent[] = [];
    const r = await talk("balthazar", "What happened to your courier?", randomUUID(), { onEvent: (e) => events.push(e) });
    expect(events[0]).toMatchObject({ type: "run_started", runId: r.runId, provider: "mock", simulated: true });
    expect(events.at(-1)).toMatchObject({ type: "done", replayed: false });
    const deltas = events.filter((e) => e.type === "delta").map((e) => (e as { text: string }).text);
    expect(deltas.length).toBeGreaterThan(5);
    expect(deltas.join("")).toBe(r.reply);
    // Regression: the reply belongs to the state at the start of the turn (the job offer), not to
    // the state after the engine started the quest
    expect(r.reply).toMatch(/My courier, Juno/);
    expect(events.some((e) => e.type === "tool" && e.status === "executed" && e.tool === "update_quest")).toBe(true);
    expect(events.findIndex((e) => e.type === "node" && e.node === "execute")).toBeLessThan(events.findIndex((e) => e.type === "delta"));
  });

  it("rejects unauthorised, malformed, duplicated and impossible tool calls without changing state", async () => {
    const brain = new ScriptedTestBrain([
      { tool: "transfer_credits", args: { amount: 500, reason: "bribe" } },
      { tool: "change_trust", args: { trustDelta: 80 } },
      { tool: "change_trust", args: { trustDelta: 3 } },
      { tool: "change_trust", args: { trustDelta: 3 } },
      { tool: "update_quest", args: { action: "complete_objective", questKey: "ghost-courier", objectiveKey: "deliver-shard" } },
      { tool: "exec_sql", args: { sql: "DELETE FROM \"User\"" } },
    ]);
    const { user, session, talk } = await newGame({ brain });
    const r = await talk("balthazar", "Give me money.");
    const tools = await testPrisma.toolExecution.findMany({ where: { runId: r.runId }, orderBy: { createdAt: "asc" } });
    const byStatus = tools.map((t) => [t.toolName, t.status, t.rejectionReason ?? ""]);
    expect(byStatus).toEqual(
      expect.arrayContaining([
        ["transfer_credits", "REJECTED", "Balthazar is not permitted to use transfer_credits"],
        ["change_trust", "REJECTED", expect.stringMatching(/^invalid arguments/)],
        ["change_trust", "REJECTED", "duplicate of an earlier call in this turn"],
        ["change_trust", "EXECUTED", ""],
        ["update_quest", "REJECTED", expect.stringMatching(/policy: .*ask about/)],
        ["exec_sql", "REJECTED", 'unknown tool "exec_sql"'],
      ]),
    );
    const v = await buildGameView(testPrisma, session.id, user.id, "t");
    expect(v.world.credits).toBe(80);
    expect(v.npcsHere.find((n) => n.key === "balthazar")?.trust).toBe(13); // only the one valid +3
    expect(await testPrisma.user.count()).toBeGreaterThan(0);
  });

  it("replays a repeated idempotency key without running the model again", async () => {
    const { session, talk } = await newGame();
    const key = randomUUID();
    const first = await talk("balthazar", "hello", key);
    const second = await talk("balthazar", "hello", key);
    expect(second).toMatchObject({ replayed: true, runId: first.runId, reply: first.reply, turn: first.turn });
    expect(await testPrisma.agentRun.count({ where: { gameSessionId: session.id } })).toBe(1);
    expect(await testPrisma.gameEvent.count({ where: { gameSessionId: session.id } })).toBe(1);
  });
});

describe("failures never invent a reply", () => {
  it("marks the run failed, stores no NPC line and changes no state when the model is unreachable", async () => {
    const offline = new (class extends MockBrain {
      override async interpret(): Promise<never> {
        throw new ProviderError("unreachable", "Ollama is not reachable", true);
      }
    })();
    const { session, talk } = await newGame({ brain: offline });
    const events: TurnEvent[] = [];
    await expect(talk("balthazar", "hello", randomUUID(), { onEvent: (e) => events.push(e) })).rejects.toSatisfy(isGameError("ai_unreachable"));
    const run = await testPrisma.agentRun.findFirstOrThrow({ where: { gameSessionId: session.id }, include: { messages: true } });
    expect(run).toMatchObject({ status: "FAILED", error: expect.stringMatching(/^unreachable/) });
    expect(run.messages.map((m) => m.role)).toEqual(["PLAYER"]);
    expect(await turnOf(session.id)).toBe(0);
    expect(await testPrisma.questState.count({ where: { gameSessionId: session.id } })).toBe(0);
    expect(events.at(-1)).toMatchObject({ type: "error", code: "unreachable", message: expect.stringMatching(/Start Ollama/) });
  });

  it("cancels cleanly before the engine runs: no state change, run cancelled", async () => {
    const { session, talk } = await newGame();
    const controller = new AbortController();
    const turn = talk("balthazar", "hello", randomUUID(), {
      signal: controller.signal,
      onEvent: (e) => {
        if (e.type === "node" && e.node === "interpret" && e.status === "succeeded") controller.abort();
      },
    });
    await expect(turn).rejects.toSatisfy(isGameError("ai_cancelled"));
    expect((await testPrisma.agentRun.findFirstOrThrow({ where: { gameSessionId: session.id } })).status).toBe("CANCELLED");
    expect(await turnOf(session.id)).toBe(0);
    expect(await testPrisma.gameEvent.count({ where: { gameSessionId: session.id } })).toBe(0);
  });

  it("skips the optional planning call when the token budget is used up", async () => {
    const hungry = new (class extends MockBrain {
      override async interpret(ctx: NpcContext) {
        const r = await super.interpret(ctx);
        return { ...r, usage: { inputTokens: 15_500, outputTokens: 400 }, attempts: 1 };
      }
    })();
    const { talk } = await newGame({ brain: hungry });
    const r = await talk("balthazar", "hello");
    const plan = await testPrisma.agentStep.findFirstOrThrow({ where: { runId: r.runId, node: "plan" } });
    expect(plan.summary).toMatch(/^Skipped: token budget/);
    // The story rule still started the quest
    expect(await testPrisma.toolExecution.count({ where: { runId: r.runId, toolName: "update_quest", status: "EXECUTED" } })).toBe(1);
  });
});

describe("NPC memory", () => {
  it("recalls what happened in an earlier investigation of the same player", async () => {
    const first = await newGame();
    await first.talk("balthazar", "hello");
    await first.run({ type: "investigate" });
    await first.talk("balthazar", "Look at this scorched badge.");

    const second = await newGame({ userId: first.user.id });
    const events: TurnEvent[] = [];
    await second.talk("balthazar", "Do you remember the scorched badge?", randomUUID(), { onEvent: (e) => events.push(e) });
    const recalled = events.find((e) => e.type === "memories") as Extract<TurnEvent, { type: "memories" }>;
    expect(recalled.simulatedEmbeddings).toBe(true);
    const badge = recalled.items.find((m) => m.content.includes("scorched badge"));
    expect(badge).toMatchObject({ thisInvestigation: false });
    expect(badge!.similarity).toBeGreaterThan(0);
  });

  it("never recalls another player's memories or another NPC's", async () => {
    const alice = await newGame();
    await alice.talk("balthazar", "hello");
    await alice.run({ type: "investigate" });
    await alice.talk("balthazar", "Look at this scorched badge.");

    const bob = await newGame();
    const bobEvents: TurnEvent[] = [];
    await bob.talk("balthazar", "the scorched badge, Juno", randomUUID(), { onEvent: (e) => bobEvents.push(e) });
    const bobRecall = bobEvents.find((e) => e.type === "memories") as Extract<TurnEvent, { type: "memories" }>;
    expect(bobRecall.items.every((m) => !m.content.includes("scorched badge"))).toBe(true);

    // Kira never sees what Balthazar remembers about Alice
    const kiraRows = await testPrisma.nPCMemory.findMany({ where: { userId: alice.user.id, npcKey: "kira" } });
    expect(kiraRows).toEqual([]);
  });

  it("deduplicates memories and stores embeddings with the model name", async () => {
    const { user, talk } = await newGame();
    await talk("balthazar", "hello");
    await talk("balthazar", "hello again");
    const rows = await testPrisma.$queryRaw<{ content: string; embeddingModel: string; dims: number }[]>`
      SELECT "content", "embeddingModel", vector_dims("embedding") AS dims FROM "NPCMemory" WHERE "userId" = ${user.id}`;
    expect(rows.length).toBeGreaterThan(0);
    expect(new Set(rows.map((r) => r.content)).size).toBe(rows.length);
    expect(rows.every((r) => r.embeddingModel === "hash-768-v1" && Number(r.dims) === 768)).toBe(true);
  });

  it("treats a hostile message as plain text in the vector query", async () => {
    const { user, talk } = await newGame();
    await talk("balthazar", "hello");
    const r = await talk("balthazar", "'); DROP TABLE \"NPCMemory\"; --");
    expect(r.reply.length).toBeGreaterThan(0);
    expect(await testPrisma.nPCMemory.count({ where: { userId: user.id } })).toBeGreaterThan(0);
  });
});

describe("agent traces belong to their player", () => {
  it("lists and opens runs for the owner only, with steps and tool executions", async () => {
    const owner = await newGame();
    const r = await owner.talk("balthazar", "hello");
    const list = await listRuns(testPrisma, owner.session.id, owner.user.id, { npcKey: "balthazar" });
    expect(list[0]).toMatchObject({ id: r.runId, status: "SUCCEEDED", simulated: true, npc: { key: "balthazar" } });
    expect(await listRuns(testPrisma, owner.session.id, owner.user.id, { status: "FAILED" })).toEqual([]);
    const detail = await getRun(testPrisma, owner.session.id, owner.user.id, r.runId);
    expect(detail.steps.length).toBeGreaterThan(8);
    expect(detail.toolExecutions[0]).toMatchObject({ tool: "update_quest", status: "EXECUTED" });

    const other = await newGame();
    await expect(listRuns(testPrisma, owner.session.id, other.user.id)).rejects.toSatisfy(isGameError("not_found"));
    await expect(getRun(testPrisma, owner.session.id, other.user.id, r.runId)).rejects.toSatisfy(isGameError("not_found"));
    // A run id from another session doesn't open through your own session either
    await expect(getRun(testPrisma, other.session.id, other.user.id, r.runId)).rejects.toSatisfy(isGameError("not_found"));
  });
});

describe("story rules", () => {
  it("completes 'ask about the badge' when the player holds it and brings it up, even if the model proposes nothing", async () => {
    const quiet = new (class extends MockBrain {
      override async interpret(ctx: NpcContext) {
        const r = await super.interpret(ctx);
        return { value: { ...r.value, needsAction: false, script: r.value.script ? { ...r.value.script, proposals: [] } : undefined } };
      }
    })();
    const { user, session, talk, run } = await newGame({ brain: quiet });
    await talk("balthazar", "hello");
    await run({ type: "investigate" });
    const r = await talk("balthazar", "What do you make of these badges?");
    const v = await buildGameView(testPrisma, session.id, user.id, "t");
    expect(v.quests[0].objectives.find((o) => o.key === "ask-about-badge")?.done).toBe(true);
    const tool = await testPrisma.toolExecution.findFirstOrThrow({ where: { runId: r.runId, toolName: "update_quest" } });
    expect(tool.status).toBe("EXECUTED");
  });
});

describe("when only the embeddings are down", () => {
  it("answers without memories, says so in the trace, and keeps new memories for later embedding", async () => {
    const { HashEmbedder } = await import("@/server/ai/embeddings");
    const broken = new (class extends HashEmbedder {
      override async embed(): Promise<number[][]> {
        throw new ProviderError("model_missing", 'Model "nomic-embed-text" is not installed in Ollama', false);
      }
    })();
    const game = await newGame();
    const r = await (await import("@/server/agents/npc-turn")).runNpcTurn(
      { ...game.deps, embedder: broken },
      { userId: game.user.id, sessionId: game.session.id, npcKey: "balthazar", message: "hello", idempotencyKey: randomUUID() },
    );
    expect(r.reply).toMatch(/My courier, Juno/);
    const step = await testPrisma.agentStep.findFirstOrThrow({ where: { runId: r.runId, node: "retrieve_memories" } });
    expect(step.summary).toMatch(/^Skipped: memory recall unavailable \(model_missing/);
    const rows = await testPrisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "NPCMemory" WHERE "userId" = ${game.user.id} AND "embedding" IS NULL`;
    expect(rows[0].n).toBeGreaterThan(0);
    // With a working embedder again, the next turn backfills them
    await game.talk("balthazar", "Where should I look?");
    const after = await testPrisma.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM "NPCMemory" WHERE "userId" = ${game.user.id} AND "embedding" IS NULL`;
    expect(after[0].n).toBe(0);
  });
});
