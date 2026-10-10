import { describe, expect, it } from "vitest";
import { checkToolCalls, type ToolCall } from "@/server/agents/tools";
import { fakeContext } from "../support/fake-context";

const call = (tool: string, args: unknown): ToolCall => ({ tool, args, source: "model" });
const verdicts = (npcKey: string, calls: ToolCall[], ctx = fakeContext()) => checkToolCalls(ctx, npcKey, calls, 6).map((d) => (d.status === "approved" ? "ok" : d.reason));

describe("NPC tool calls", () => {
  it("turns permitted calls into engine effects for the speaking NPC", () => {
    const [d] = checkToolCalls(fakeContext(), "balthazar", [call("change_trust", { trustDelta: 5 })], 6);
    expect(d).toMatchObject({ status: "approved", effects: [{ type: "trust", npcKey: "balthazar", delta: 5 }] });
    const [q] = checkToolCalls(fakeContext(), "balthazar", [call("update_quest", { action: "start", questKey: "ghost-courier" })], 6);
    expect(q).toMatchObject({ status: "approved", effects: [{ type: "quest_start", questKey: "ghost-courier" }] });
  });

  it("rejects unknown tools and tools the NPC isn't permitted to use", () => {
    expect(verdicts("kira", [call("run_shell", { cmd: "rm -rf /" })])).toEqual(['unknown tool "run_shell"']);
    expect(verdicts("kira", [call("transfer_credits", { amount: 500, reason: "gift" })])).toEqual(["Kira Okonkwo-Vale is not permitted to use transfer_credits"]);
    expect(verdicts("vex-404", [call("update_quest", { action: "start", questKey: "ghost-courier" })])[0]).toMatch(/not permitted/);
  });

  it("rejects malformed arguments, including extra fields", () => {
    expect(verdicts("balthazar", [call("change_trust", { trustDelta: 99 })])[0]).toMatch(/^invalid arguments/);
    expect(verdicts("balthazar", [call("change_trust", {})])[0]).toMatch(/^invalid arguments/);
    expect(verdicts("balthazar", [call("change_trust", { trustDelta: 5, npcKey: "kira" })])[0]).toMatch(/^invalid arguments/);
    expect(verdicts("balthazar", [call("update_quest", { action: "start", questKey: "'; DROP TABLE" })])[0]).toMatch(/^invalid arguments/);
  });

  it("rejects duplicates, too many calls, and limits that span the whole turn", () => {
    expect(verdicts("balthazar", [call("change_trust", { trustDelta: 5 }), call("change_trust", { trustDelta: 5 })])).toEqual(["ok", "duplicate of an earlier call in this turn"]);
    expect(verdicts("vex-404", [call("trigger_security_alert", { reason: "a" }), call("trigger_security_alert", { reason: "b" })])).toEqual(["ok", "the alert can rise at most one level per turn"]);
    expect(verdicts("balthazar", [call("change_trust", { trustDelta: 20 }), call("change_trust", { trustDelta: 10 })])).toEqual(["ok", "trust can change by at most 25 per turn"]);
    const many = Array.from({ length: 8 }, (_, i) => call("search_known_memories", { query: `q${i}` }));
    expect(verdicts("balthazar", many).filter((v) => v !== "ok")).toEqual(["more than 6 tool calls in one turn", "more than 6 tool calls in one turn"]);
  });

  it("still applies the engine policy when a tool is permitted: credits and items stay engine-only", () => {
    const generous = fakeContext({ allowedTools: { kira: ["transfer_credits", "transfer_item", "unlock_location"] } });
    expect(verdicts("kira", [call("transfer_credits", { amount: 100, reason: "tip" })], generous)[0]).toMatch(/^policy: .*credits/);
    expect(verdicts("kira", [call("transfer_item", { itemKey: "signal-decoder", direction: "to_player" })], generous)[0]).toMatch(/^policy: /);
    expect(verdicts("kira", [call("unlock_location", { locationKey: "aether-tower" })], generous)[0]).toMatch(/^policy: /);
  });

  it("lets NPCs only start their own quests", () => {
    const ctx = fakeContext({ allowedTools: { kira: ["update_quest"] } });
    expect(verdicts("kira", [call("update_quest", { action: "start", questKey: "ghost-courier" })], ctx)[0]).toMatch(/^policy: /);
  });
});

describe("key normalisation", () => {
  it("maps an exact title from this scenario to its key and leaves anything else to validation", () => {
    const [ok] = checkToolCalls(fakeContext(), "balthazar", [call("update_quest", { action: "start", questKey: "The Ghost Courier" })], 6);
    expect(ok).toMatchObject({ status: "approved", args: { questKey: "ghost-courier" }, normalized: ['questKey: "The Ghost Courier" → ghost-courier'] });
    const [obj] = checkToolCalls(fakeContext(), "balthazar", [call("update_quest", { action: "complete_objective", questKey: "ghost-courier", objectiveKey: "ask_about_badge" })], 6);
    expect(obj).toMatchObject({ status: "approved", args: { objectiveKey: "ask-about-badge" } });
    expect(verdicts("balthazar", [call("update_quest", { action: "start", questKey: "Some Other Quest" })])[0]).toMatch(/^invalid arguments/);
    expect(verdicts("balthazar", [call("inspect_evidence", { evidenceKey: "Scorched Courier Badge" })])).toEqual(["ok"]);
  });
});
