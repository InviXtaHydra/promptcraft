import { describe, expect, it } from "vitest";
import { neonBabylon } from "@/content/neon-babylon";
import { scenarioSchema, validateScenarioReferences } from "@/content/scenario-schema";
import { BOUNDS, clamp, effectSchema } from "@/server/engine/effects";
import { checkProposals } from "@/server/engine/policy";
import { fakeContext } from "../support/fake-context";

const scenario = scenarioSchema.parse(neonBabylon);

describe("the NPC policy", () => {
  const ctx = fakeContext();
  const verdicts = (npcKey: string, proposals: unknown[]) => checkProposals(ctx, npcKey, proposals).map((c) => (c.ok ? "ok" : c.reason));

  it("allows what the NPC is permitted to do", () => {
    expect(verdicts("balthazar", [{ type: "quest_start", questKey: "ghost-courier" }, { type: "trust", npcKey: "balthazar", delta: 5 }])).toEqual(["ok", "ok"]);
    expect(verdicts("vex-404", [{ type: "alert", delta: 1 }])).toEqual(["ok"]);
  });

  it("rejects effects outside the NPC's permissions", () => {
    expect(verdicts("kira", [{ type: "credits", delta: 500 }])).toEqual(["Kira Okonkwo-Vale may not use credits"]);
    expect(verdicts("kira", [{ type: "unlock_location", locationKey: "aether-tower" }])).toEqual(["Kira Okonkwo-Vale may not use unlock_location"]);
  });

  it("keeps NPCs to their own relationship, memories, quests, evidence and faction", () => {
    expect(verdicts("kira", [{ type: "trust", npcKey: "balthazar", delta: 50 }])[0]).toMatch(/own relationship/);
    expect(verdicts("balthazar", [{ type: "memory", npcKey: "kira", kind: "EPISODIC", content: "x", importance: 5 }])[0]).toMatch(/own relationship/);
    expect(verdicts("balthazar", [{ type: "objective", questKey: "ghost-courier", objectiveKey: "deliver-shard" }])[0]).toMatch(/ask about/);
    expect(verdicts("vex-404", [{ type: "faction", factionKey: "rustborn", delta: -10 }])[0]).toMatch(/own faction/);
  });

  it("bounds the alert: at most +1 per turn and never lowered by an NPC", () => {
    expect(verdicts("vex-404", [{ type: "alert", delta: 2 }])[0]).toMatch(/at most one level/);
    expect(verdicts("vex-404", [{ type: "alert", delta: 1 }, { type: "alert", delta: 1 }])).toEqual(["ok", "the alert can rise at most one level per turn"]);
    expect(verdicts("vex-404", [{ type: "alert", delta: -1 }])[0]).toMatch(/can't lower/);
  });

  it("rejects malformed proposals and caps how many are considered", () => {
    expect(verdicts("balthazar", [{ type: "trust", npcKey: "balthazar", delta: "lots" }])[0]).toMatch(/^malformed/);
    expect(verdicts("balthazar", [{ type: "drop_table" }])[0]).toMatch(/^malformed/);
    const many = Array.from({ length: 8 }, () => ({ type: "trust", npcKey: "balthazar", delta: 1 }));
    expect(verdicts("balthazar", many).filter((v) => v !== "ok")).toHaveLength(2);
  });
});

describe("effects and scenario content", () => {
  it("validates effect keys and ranges", () => {
    expect(effectSchema.safeParse({ type: "trust", npcKey: "balthazar", delta: 51 }).success).toBe(false);
    expect(effectSchema.safeParse({ type: "unlock_location", locationKey: "../etc" }).success).toBe(false);
    expect(clamp(140, BOUNDS.trust)).toBe(100);
    expect(clamp(-3, BOUNDS.alert)).toBe(0);
  });

  it("ships a scenario whose references all resolve", () => {
    expect(validateScenarioReferences(scenario)).toEqual([]);
  });

  it("catches broken references in a scenario", () => {
    const broken = scenarioSchema.parse({
      ...neonBabylon,
      quests: [{ ...neonBabylon.quests[0], objectives: [{ key: "x", description: "x", kind: "COLLECT_ITEM", targetKey: "unobtainium" }] }],
    });
    expect(validateScenarioReferences(broken)).toContain('quest ghost-courier objective x: unknown item "unobtainium"');
  });
});
