import { randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { GameError } from "@/server/errors";
import { runSimulationTick } from "@/server/engine/simulation";
import { buildGameView } from "@/server/engine/view";
import { newGame, testPrisma } from "../support/factories";

const isGameError = (code: string) => (e: unknown) => e instanceof GameError && e.code === code;
type Game = Awaited<ReturnType<typeof newGame>>;
const view = (g: Game) => buildGameView(testPrisma, g.session.id, g.user.id, "t");
const tick = (g: Game) => runSimulationTick(testPrisma, { sessionId: g.session.id, userId: g.user.id, trigger: "MANUAL", idempotencyKey: randomUUID() });

/** The Ghost Courier, done: badge asked about, shard delivered (Balthazar trust 30). */
async function afterFirstQuest() {
  const g = await newGame();
  await g.talk("balthazar", "hello");
  await g.run({ type: "investigate" });
  await g.talk("balthazar", "Look at this scorched badge.");
  await g.run({ type: "give", npcKey: "balthazar", itemKey: "encrypted-shard" });
  return g;
}

/** Route A: Kira's decoder and forged clearance. */
async function intoTheTowerViaKira() {
  const g = await afterFirstQuest();
  await g.run({ type: "travel", locationKey: "cyber-bazaar" });
  await g.talk("kira", "hi");
  await g.run({ type: "investigate" });
  await g.run({ type: "buy", npcKey: "kira", itemKey: "signal-decoder" });
  await g.run({ type: "buy", npcKey: "kira", itemKey: "aether-clearance" });
  await g.run({ type: "travel", locationKey: "aether-tower" });
  await g.run({ type: "investigate" });
  return g;
}

describe("Project Genesis", () => {
  it("can be solved through Kira: clearance, tower, evidence, and the best ending", async () => {
    const g = await intoTheTowerViaKira();
    let v = await view(g);
    expect(v.location.key).toBe("aether-tower");
    expect(v.evidence.map((e) => e.key)).toEqual(expect.arrayContaining(["genesis-lab-log", "juno-lattice-record", "transit-record", "relay-map-receipt"]));
    expect(v.investigation.canSubmit).toBe(true);
    // Links appear once both ends are known
    expect(v.investigation.links).toContainEqual(expect.objectContaining({ from: "genesis-lab-log", to: "hale-imura", relation: "IMPLICATES" }));
    expect(v.investigation.links).toContainEqual(expect.objectContaining({ from: "genesis-lab-log", to: "kira", relation: "EXONERATES" }));

    const result = await g.run({ type: "submit_case", suspectKey: "hale-imura", evidenceKeys: ["genesis-lab-log", "juno-lattice-record", "transit-record"] });
    expect(result.outcomes.map((o) => o.text)).toContain("Genesis Exposed");
    v = await view(g);
    expect(v.session.status).toBe("COMPLETED");
    expect(v.investigation.ending).toMatchObject({ key: "genesis-exposed", tone: "triumph", suspectKey: "hale-imura" });
    expect(v.quests.find((q) => q.key === "project-genesis")?.status).toBe("COMPLETED");
    expect(v.factions.find((f) => f.key === "aether-dynamics")?.reputation).toBeLessThanOrEqual(-40);
    // A closed investigation takes no more commands, and one case file is all you get
    await expect(g.run({ type: "investigate" })).rejects.toSatisfy(isGameError("session_closed"));
  });

  it("stays solvable without Kira: Balthazar's old keycard opens the tower", async () => {
    const g = await afterFirstQuest();
    await g.run({ type: "travel", locationKey: "cyber-bazaar" });
    await g.talk("kira", "Shut up and hand over the decoder or else."); // Kira now distrusts the player
    await g.run({ type: "travel", locationKey: "neon-slums" });
    await g.talk("balthazar", "Got a minute?"); // story rule: he offers Old Debts
    await g.talk("balthazar", "What is Project Genesis, really?"); // asking about the shard log: +10
    let v = await view(g);
    expect(v.quests.find((q) => q.key === "old-debts")?.status).toBe("ACTIVE");
    expect(v.npcsHere.find((n) => n.key === "balthazar")?.trust).toBe(40);
    expect(v.npcsHere.length).toBe(1);

    // The city moves: Balthazar works his contacts (+10 trust, new evidence), which completes Old Debts
    const t = await tick(g);
    expect(t.actions).toContainEqual(expect.objectContaining({ intention: "balthazar-searches", status: "executed" }));
    v = await view(g);
    expect(v.inventory.map((i) => i.key)).toContain("lattice-keycard");
    expect(v.evidence.map((e) => e.key)).toEqual(expect.arrayContaining(["drive-component-trace", "balthazar-confession"]));
    expect(v.inventory.map((i) => i.key)).not.toContain("aether-clearance");

    await g.run({ type: "travel", locationKey: "aether-tower" });
    await g.run({ type: "investigate" });
    await g.run({ type: "submit_case", suspectKey: "hale-imura", evidenceKeys: ["genesis-lab-log", "juno-lattice-record", "drive-component-trace"] });
    expect((await view(g)).investigation.ending?.key).toBe("genesis-exposed");
  });

  it("reaches other endings from other case files", async () => {
    const half = await intoTheTowerViaKira();
    await half.run({ type: "submit_case", suspectKey: "hale-imura", evidenceKeys: ["genesis-lab-log"] });
    expect((await view(half)).investigation.ending?.key).toBe("half-truth");

    const wrong = await intoTheTowerViaKira();
    const kiraTrustBefore = (await testPrisma.nPCRelationship.findFirstOrThrow({ where: { gameSessionId: wrong.session.id, npc: { key: "kira" } } })).trust;
    await wrong.run({ type: "submit_case", suspectKey: "kira", evidenceKeys: ["relay-map-receipt"] });
    expect((await view(wrong)).investigation.ending?.key).toBe("wrong-broker");
    const kiraTrustAfter = (await testPrisma.nPCRelationship.findFirstOrThrow({ where: { gameSessionId: wrong.session.id, npc: { key: "kira" } } })).trust;
    expect(kiraTrustAfter).toBe(kiraTrustBefore - 50);

    const dismissed = await intoTheTowerViaKira();
    await dismissed.run({ type: "submit_case", suspectKey: "hale-imura", evidenceKeys: ["relay-map-receipt"] });
    expect((await view(dismissed)).investigation.ending?.key).toBe("case-dismissed");
  });

  it("puts VEX-404's offer to the player, and taking it decides the ending whatever the file says", async () => {
    const g = await intoTheTowerViaKira();
    // The simulation notices the stolen lab log (it may take a tick if the budget is used)
    for (let i = 0; i < 4 && !(await view(g)).choices.length; i++) await tick(g);
    const v = await view(g);
    expect(v.choices).toEqual([expect.objectContaining({ key: "aether-offer", options: [expect.objectContaining({ key: "accept" }), expect.objectContaining({ key: "refuse" })] })]);
    const credits = v.world.credits;
    await g.run({ type: "choose", choiceKey: "aether-offer", optionKey: "accept" });
    expect((await view(g)).world.credits).toBe(credits + 500);
    await expect(g.run({ type: "choose", choiceKey: "aether-offer", optionKey: "refuse" })).rejects.toSatisfy(isGameError("already_decided"));
    await g.run({ type: "submit_case", suspectKey: "hale-imura", evidenceKeys: ["genesis-lab-log", "juno-lattice-record", "transit-record"] });
    expect((await view(g)).investigation.ending?.key).toBe("the-deal");
  });

  it("scores hypotheses from the evidence links without changing the world", async () => {
    const g = await intoTheTowerViaKira();
    const before = await view(g);
    await g.run({ type: "save_hypothesis", suspectKey: "hale-imura", evidenceKeys: ["genesis-lab-log", "juno-lattice-record", "transit-record"], note: "Floor 140" });
    await g.run({ type: "save_hypothesis", suspectKey: "kira", evidenceKeys: ["relay-map-receipt", "genesis-lab-log"] });
    const after = await view(g);
    const [imura, kira] = after.investigation.hypotheses;
    expect(imura.assessment.verdict).toBe("strong");
    expect(kira.assessment.verdict).toBe("contradicted"); // the lab log clears her
    expect(kira.assessment.reasons.join(" ")).toMatch(/clears them/);
    expect(after.world).toEqual(before.world);
    await g.run({ type: "discard_hypothesis", hypothesisId: kira.id });
    expect((await view(g)).investigation.hypotheses).toHaveLength(1);
  });

  it("refuses case files that are early, use unknown evidence, or come twice", async () => {
    const early = await afterFirstQuest();
    await expect(early.run({ type: "submit_case", suspectKey: "hale-imura", evidenceKeys: ["genesis-lab-log"] })).rejects.toSatisfy(isGameError("unknown_evidence"));
    await expect(early.run({ type: "submit_case", suspectKey: "hale-imura", evidenceKeys: ["scorched-badge"] })).resolves.toBeDefined(); // the case can be closed early: it's just weak
    expect((await view(early)).investigation.ending?.key).toBe("case-dismissed");

    const fresh = await newGame();
    await expect(fresh.run({ type: "submit_case", suspectKey: "hale-imura", evidenceKeys: ["scorched-badge"] })).rejects.toSatisfy(isGameError("no_open_case"));
    await expect(fresh.run({ type: "save_hypothesis", suspectKey: "nobody", evidenceKeys: ["scorched-badge"] })).rejects.toSatisfy(isGameError("unknown_suspect"));
  });
});
