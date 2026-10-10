import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { mockDialogueProvider } from "@/server/dialogue/mock";
import { GameError } from "@/server/errors";
import { executeCommand } from "@/server/engine";
import { buildGameView, getConversation } from "@/server/engine/view";
import { makePlayer, newGame, testPrisma } from "../support/factories";

async function expectRejected(promise: Promise<unknown>, code: string) {
  await expect(promise).rejects.toSatisfy((e: unknown) => e instanceof GameError && e.code === code);
}

/** Plays up to the moment the shard can be delivered. */
async function readyToDeliver() {
  const game = await newGame();
  await game.run({ type: "talk", npcKey: "balthazar", message: "hello" });
  await game.run({ type: "investigate" });
  return game;
}

describe("rewards are granted exactly once", () => {
  it("replays a repeated idempotency key instead of running the command again", async () => {
    const { user, session, run } = await readyToDeliver();
    const key = randomUUID();
    const first = await run({ type: "give", npcKey: "balthazar", itemKey: "encrypted-shard" }, key);
    const second = await run({ type: "give", npcKey: "balthazar", itemKey: "encrypted-shard" }, key);
    expect(first.replayed).toBe(false);
    expect(second).toEqual({ ...first, replayed: true });
    expect((await buildGameView(testPrisma, session.id, user.id, "t")).world.credits).toBe(230);
  });

  it("refuses to reuse an idempotency key for a different action", async () => {
    const { run } = await readyToDeliver();
    const key = randomUUID();
    await run({ type: "investigate" }, key);
    await expectRejected(run({ type: "travel", locationKey: "cyber-bazaar" }, key), "idempotency_key_reused");
  });

  it("lets only one of two simultaneous deliveries through", async () => {
    const { user, session, run } = await readyToDeliver();
    const results = await Promise.allSettled([
      run({ type: "give", npcKey: "balthazar", itemKey: "encrypted-shard" }),
      run({ type: "give", npcKey: "balthazar", itemKey: "encrypted-shard" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const failure = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect(failure.reason).toBeInstanceOf(GameError);
    const v = await buildGameView(testPrisma, session.id, user.id, "t");
    expect(v.world.credits).toBe(230);
    expect(v.inventory.filter((i) => i.key === "bazaar-pass")).toHaveLength(1);
    const state = await testPrisma.questState.findMany({ where: { gameSessionId: session.id, status: "COMPLETED" } });
    expect(state).toHaveLength(1);
  });
});

describe("the engine validates every command against the server-side state", () => {
  it("won't travel to a locked location and leaves the state unchanged", async () => {
    const { user, session, run } = await newGame();
    await expectRejected(run({ type: "travel", locationKey: "aether-tower" }), "location_locked");
    await expectRejected(run({ type: "travel", locationKey: "cyber-bazaar" }), "location_locked");
    const v = await buildGameView(testPrisma, session.id, user.id, "t");
    expect(v.location.key).toBe("neon-slums");
    expect(v.session.turn).toBe(0);
  });

  it("rejects malformed commands and unknown keys", async () => {
    const { run, user, session } = await newGame();
    const raw = (command: unknown) => executeCommand(testPrisma, { userId: user.id, sessionId: session.id, command, idempotencyKey: randomUUID(), reactions: mockDialogueProvider });
    await expectRejected(raw({ type: "teleport", locationKey: "aether-tower" }), "invalid_command");
    await expectRejected(raw({ type: "talk", npcKey: "balthazar", message: "hi" }), "invalid_command"); // talking goes through the agent graph
    await expectRejected(run({ type: "talk", npcKey: "balthazar", message: "" }), "invalid_input");
    await expectRejected(run({ type: "talk", npcKey: "balthazar", message: "x".repeat(501) }), "invalid_input");
    await expectRejected(raw({ type: "travel", locationKey: "../../etc" }), "invalid_command");
    await expectRejected(run({ type: "talk", npcKey: "kira", message: "hi" }), "npc_not_here");
    await expectRejected(run({ type: "give", npcKey: "balthazar", itemKey: "encrypted-shard" }), "not_owned");
    await expectRejected(run({ type: "give", npcKey: "balthazar", itemKey: "cracked-deck" }), "not_needed");
  });

  it("won't sell what the player can't afford", async () => {
    const { user, session, run } = await readyToDeliver();
    await run({ type: "give", npcKey: "balthazar", itemKey: "encrypted-shard" });
    await run({ type: "travel", locationKey: "cyber-bazaar" });
    await testPrisma.worldState.update({ where: { gameSessionId: session.id }, data: { credits: 50 } });
    await expectRejected(run({ type: "buy", npcKey: "kira", itemKey: "signal-decoder" }), "insufficient_credits");
    const v = await buildGameView(testPrisma, session.id, user.id, "t");
    expect(v.world.credits).toBe(50);
    expect(v.inventory.map((i) => i.key)).not.toContain("signal-decoder");
  });

  it("keeps the security alert within 0–5 and makes Kira refuse to trade from alert 3", async () => {
    const { user, session, run } = await readyToDeliver();
    await run({ type: "give", npcKey: "balthazar", itemKey: "encrypted-shard" });
    await run({ type: "travel", locationKey: "cyber-bazaar" });
    for (let i = 0; i < 7; i++) await run({ type: "talk", npcKey: "vex-404", message: "Tell me about Project Genesis" });
    const v = await buildGameView(testPrisma, session.id, user.id, "t");
    expect(v.world.alert).toBe(5);
    expect(v.events.filter((e) => e.title.startsWith("Aether security sweep"))).toHaveLength(5);
    expect(v.npcsHere.find((n) => n.key === "kira")?.offers[0].refused).toBe(true);
    await expectRejected(run({ type: "buy", npcKey: "kira", itemKey: "signal-decoder" }), "trade_refused");
    // The sixth and seventh alert proposals were bounded by the engine, and that is in the trace
    const skipped = await testPrisma.toolExecution.findMany({ where: { run: { gameSessionId: session.id }, toolName: "trigger_security_alert", status: "REJECTED" } });
    expect(skipped.map((t) => t.rejectionReason)).toEqual(["engine: security alert is already at maximum", "engine: security alert is already at maximum"]);
  });
});

describe("players can only reach their own save games", () => {
  it("treats another player's session as not found, for reading and for acting", async () => {
    const owner = await newGame();
    await owner.run({ type: "talk", npcKey: "balthazar", message: "hello" });
    const intruder = await makePlayer();

    await expectRejected(buildGameView(testPrisma, owner.session.id, intruder.id, "x"), "not_found");
    await expectRejected(getConversation(testPrisma, owner.session.id, intruder.id, "balthazar", { id: "mock", model: "m", isSimulated: true }), "not_found");
    await expectRejected(
      executeCommand(testPrisma, { userId: intruder.id, sessionId: owner.session.id, command: { type: "investigate" }, idempotencyKey: randomUUID(), reactions: mockDialogueProvider }),
      "not_found",
    );
    // Nothing happened to the owner's game
    const v = await buildGameView(testPrisma, owner.session.id, owner.user.id, "o");
    expect(v.session.turn).toBe(1);
    expect(v.evidence).toEqual([]);
  });

  it("keeps NPC memories per save game", async () => {
    const a = await newGame();
    const b = await newGame();
    await a.run({ type: "talk", npcKey: "balthazar", message: "hello" });
    const memories = await testPrisma.nPCMemory.findMany({ where: { gameSessionId: { in: [a.session.id, b.session.id] } } });
    expect(memories.length).toBeGreaterThan(0);
    expect(memories.every((m) => m.gameSessionId === a.session.id)).toBe(true);
  });
});
