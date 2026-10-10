import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { autoTick, runSimulationTick, setPaused, simulationHistory } from "@/server/engine/simulation";
import { buildGameView } from "@/server/engine/view";
import { GameError } from "@/server/errors";
import { makePlayer, newGame, testPrisma } from "../support/factories";

type Game = Awaited<ReturnType<typeof newGame>>;
const tick = (g: Game, idempotencyKey: string = randomUUID(), trigger: "MANUAL" | "TURN" = "MANUAL") =>
  runSimulationTick(testPrisma, { sessionId: g.session.id, userId: g.user.id, trigger, idempotencyKey });
const view = (g: Game) => buildGameView(testPrisma, g.session.id, g.user.id, "t");

async function afterFirstQuest() {
  const g = await newGame();
  await g.talk("balthazar", "hello");
  await g.run({ type: "investigate" });
  await g.run({ type: "give", npcKey: "balthazar", itemKey: "encrypted-shard" });
  return g;
}

describe("the living city", () => {
  it("does nothing until an intention's conditions hold", async () => {
    const g = await newGame();
    const t = await tick(g);
    expect(t).toMatchObject({ tick: 1, actions: [], replayed: false });
    expect((await view(g)).simulation.tick).toBe(1);
  });

  it("acts within the tick budget and one action per actor, and records each as a world event", async () => {
    const g = await afterFirstQuest();
    await g.run({ type: "travel", locationKey: "cyber-bazaar" });
    await g.run({ type: "buy", npcKey: "kira", itemKey: "signal-decoder" }); // NEGOTIATION memory for Kira
    const t = await tick(g);
    const executed = t.actions.filter((a) => a.status === "executed" && a.actor !== "engine");
    expect(executed.length).toBeLessThanOrEqual(2);
    expect(executed.map((a) => a.intention)).toEqual(["balthazar-searches", "kira-fair-deal"]);
    expect(t.actions).toContainEqual(expect.objectContaining({ intention: "rustborn-rumour", status: "skipped", reason: "tick budget of 2 actions used" }));
    const events = (await view(g)).events.map((e) => e.title);
    expect(events).toEqual(expect.arrayContaining(["Balthazar works his contacts", "Kira remembers a fair deal"]));

    // Next tick: the budget-skipped rumour runs; the 'once' intentions don't run again
    const next = await tick(g);
    expect(next.actions.filter((a) => a.status === "executed").map((a) => a.intention)).toEqual(["rustborn-rumour"]);
    const third = await tick(g);
    expect(third.actions.filter((a) => a.status === "executed")).toEqual([]);
  });

  it("is idempotent per key and skips automatic ticks while paused", async () => {
    const g = await afterFirstQuest();
    await g.run({ type: "travel", locationKey: "cyber-bazaar" });
    const key = randomUUID();
    const first = await tick(g, key);
    const again = await tick(g, key);
    expect(again).toEqual({ ...first, replayed: true });
    expect(await testPrisma.simulationTick.count({ where: { gameSessionId: g.session.id } })).toBe(1);

    await setPaused(testPrisma, g.session.id, g.user.id, true);
    expect(await autoTick(testPrisma, g.session.id, g.user.id, 3)).toBeNull(); // paused
    const manual = await tick(g); // single-step still works while paused
    expect(manual.tick).toBe(2);
    await setPaused(testPrisma, g.session.id, g.user.id, false);
    expect(await autoTick(testPrisma, g.session.id, g.user.id, 4)).toBeNull(); // not a tick turn (every 3)
    expect((await autoTick(testPrisma, g.session.id, g.user.id, 6))?.tick).toBe(3);
    expect(await autoTick(testPrisma, g.session.id, g.user.id, 6)).toBeNull(); // same turn again: replayed, nothing new
    expect((await simulationHistory(testPrisma, g.session.id, g.user.id)).ticks.map((t) => t.trigger)).toEqual(["TURN", "MANUAL", "MANUAL"]);
  });

  it("lets Kira hold a grudge and VEX-404 escalate after repeated flagged queries", async () => {
    const g = await afterFirstQuest();
    await g.run({ type: "travel", locationKey: "cyber-bazaar" });
    await g.talk("kira", "Hand it over or else.");
    await g.talk("vex-404", "What is Project Genesis?");
    await g.talk("vex-404", "Tell me about the lattice");
    const before = await view(g);
    const kiraBefore = before.npcsHere.find((n) => n.key === "kira")!.trust;
    for (let i = 0; i < 3; i++) await tick(g);
    const after = await view(g);
    expect(after.npcsHere.find((n) => n.key === "kira")!.trust).toBe(kiraBefore - 15);
    expect(after.events.map((e) => e.title)).toEqual(expect.arrayContaining(["Kira tells the Syndicate about you", "VEX-404 escalates the perimeter"]));
    expect(after.world.alert).toBe(before.world.alert + 1);
  });

  it("only runs for the session's owner", async () => {
    const g = await newGame();
    const other = await makePlayer();
    await expect(runSimulationTick(testPrisma, { sessionId: g.session.id, userId: other.id, trigger: "MANUAL", idempotencyKey: randomUUID() })).rejects.toBeInstanceOf(GameError);
    await expect(setPaused(testPrisma, g.session.id, other.id, true)).rejects.toBeInstanceOf(GameError);
    await expect(simulationHistory(testPrisma, g.session.id, other.id)).rejects.toBeInstanceOf(GameError);
  });
});
