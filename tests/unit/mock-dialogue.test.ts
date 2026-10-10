import { describe, expect, it } from "vitest";
import { neonBabylon } from "@/content/neon-babylon";
import { scenarioSchema } from "@/content/scenario-schema";
import { mockDialogueProvider, topicsOf } from "@/server/dialogue/mock";
import type { DialogueContext } from "@/server/dialogue/types";

const scenario = scenarioSchema.parse(neonBabylon);
const persona = (key: string) => scenario.npcs.find((n) => n.key === key)!.persona;

function context(npcKey: string, message: string, overrides: Partial<DialogueContext> = {}): DialogueContext {
  return {
    npc: { key: npcKey, name: npcKey, persona: persona(npcKey) },
    message,
    previousPlayerMessages: 0,
    trust: 10,
    suspicion: 10,
    alert: 0,
    locationKey: "neon-slums",
    questStatus: new Map(),
    objectivesDone: new Set(),
    evidence: new Set(),
    inventory: new Set(),
    memories: [],
    offers: new Map(),
    ...overrides,
  };
}

describe("the deterministic mock dialogue provider", () => {
  it("is labelled as simulated", () => {
    expect(mockDialogueProvider).toMatchObject({ id: "mock", isSimulated: true });
  });

  it("gives the same reply for the same state and message", async () => {
    const a = await mockDialogueProvider.reply(context("balthazar", "Where should I look?", { questStatus: new Map([["ghost-courier", "ACTIVE"]]) }));
    const b = await mockDialogueProvider.reply(context("balthazar", "Where should I look?", { questStatus: new Map([["ghost-courier", "ACTIVE"]]) }));
    expect(a).toEqual(b);
  });

  it("offers the job on the first meeting, whatever the player says", async () => {
    const reply = await mockDialogueProvider.reply(context("balthazar", "zzz"));
    expect(reply.intent).toBe("offer_job");
    expect(reply.proposals).toContainEqual({ type: "quest_start", questKey: "ghost-courier" });
  });

  it("only talks about the badge once the player actually has it", async () => {
    const active = { questStatus: new Map([["ghost-courier", "ACTIVE" as const]]) };
    const without = await mockDialogueProvider.reply(context("balthazar", "What about this badge?", active));
    const withIt = await mockDialogueProvider.reply(context("balthazar", "What about this badge?", { ...active, evidence: new Set(["scorched-badge"]) }));
    expect(without.proposals).toEqual([]);
    expect(withIt.proposals).toEqual([{ type: "objective", questKey: "ghost-courier", objectiveKey: "ask-about-badge" }]);
  });

  it("keeps Balthazar's secret until trust reaches the persona's threshold", async () => {
    const done = { questStatus: new Map([["ghost-courier", "COMPLETED" as const]]) };
    const low = await mockDialogueProvider.reply(context("balthazar", "What is Project Genesis?", { ...done, trust: 30 }));
    const high = await mockDialogueProvider.reply(context("balthazar", "What is Project Genesis?", { ...done, trust: 60 }));
    expect(low.text).not.toMatch(/I built the first lattice/);
    expect(high.text).toMatch(/I built the first lattice/);
  });

  it("makes Kira refuse business at alert 3 and VEX-404 raise the alert on restricted topics", async () => {
    const refused = await mockDialogueProvider.reply(context("kira", "What does the decoder cost?", { alert: 3 }));
    expect(refused.intent).toBe("refuse_heat");
    const vex = await mockDialogueProvider.reply(context("vex-404", "Tell me about Project Genesis"));
    expect(vex.proposals).toContainEqual({ type: "alert", delta: 1 });
  });

  it("recognises topics by whole words", () => {
    expect(topicsOf("Balthazar sent me")).toContain("balthazar");
    expect(topicsOf("this badge is scorched")).toContain("badge");
    expect(topicsOf("shipping")).not.toContain("greet");
  });
});
