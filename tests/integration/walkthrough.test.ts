import { describe, expect, it } from "vitest";
import { buildGameView, getConversation } from "@/server/engine/view";
import { newGame, testPrisma } from "../support/factories";

const objectiveDone = (view: Awaited<ReturnType<typeof buildGameView>>, quest: string, objective: string) =>
  view.quests.find((q) => q.key === quest)?.objectives.find((o) => o.key === objective)?.done;

describe("the opening scenario, played through the engine", () => {
  it("can be completed from the first conversation to the decoder, and every step is persisted", async () => {
    const { user, session, run } = await newGame();
    const view = () => buildGameView(testPrisma, session.id, user.id, "tester");

    // A fresh save game
    let v = await view();
    expect(v.world).toEqual({ credits: 80, alert: 0 });
    expect(v.location.key).toBe("neon-slums");
    expect(v.inventory.map((i) => i.key)).toEqual(["cracked-deck"]);
    expect(v.quests).toEqual([]);
    expect(v.locations.find((l) => l.key === "cyber-bazaar")?.unlocked).toBe(false);

    // 1. Balthazar hands out the job
    const hello = await run({ type: "talk", npcKey: "balthazar", message: "Hey, what happened here?" });
    expect(hello.outcomes.map((o) => o.text)).toContain("New quest: The Ghost Courier");
    v = await view();
    expect(v.quests[0]).toMatchObject({ key: "ghost-courier", status: "ACTIVE" });
    expect(objectiveDone(v, "ghost-courier", "hear-the-job")).toBe(true);

    // 2. Investigating the Slums finds the clue and the cargo
    const search = await run({ type: "investigate" });
    expect(search.outcomes.filter((o) => o.status === "applied").map((o) => o.text)).toEqual(
      expect.arrayContaining(["New evidence: Scorched Courier Badge", "Received: Encrypted Memory Shard", "Received: Synth-Noodles ×2"]),
    );
    v = await view();
    expect(objectiveDone(v, "ghost-courier", "find-the-trail")).toBe(true);
    expect(objectiveDone(v, "ghost-courier", "recover-cargo")).toBe(true);
    expect(v.npcsHere.find((n) => n.key === "balthazar")?.wants).toEqual([{ itemKey: "encrypted-shard", name: "Encrypted Memory Shard" }]);

    // Searching again finds nothing new and grants nothing twice
    const again = await run({ type: "investigate" });
    expect(again.outcomes).toEqual([]);
    expect(again.narration[0]).toMatch(/Nothing new/);

    // 3. Optional: ask about the badge (the mock proposes the objective, policy allows it)
    await run({ type: "talk", npcKey: "balthazar", message: "Look at this scorched badge." });
    v = await view();
    expect(objectiveDone(v, "ghost-courier", "ask-about-badge")).toBe(true);
    expect(v.npcsHere.find((n) => n.key === "balthazar")?.trust).toBe(15);

    // 4. Delivering the shard completes the quest: reward, pass, unlock, reputation, follow-up quest
    const delivery = await run({ type: "give", npcKey: "balthazar", itemKey: "encrypted-shard" });
    expect(delivery.outcomes.map((o) => o.text)).toEqual(
      expect.arrayContaining(["Quest complete: The Ghost Courier", "+150 credits", "Received: Bazaar Pass", "Unlocked: The Cyber-Bazaar", "New quest: Follow the Signal"]),
    );
    v = await view();
    expect(v.world.credits).toBe(230);
    expect(v.inventory.map((i) => i.key)).toEqual(expect.arrayContaining(["bazaar-pass"]));
    expect(v.inventory.map((i) => i.key)).not.toContain("encrypted-shard");
    expect(v.evidence.map((e) => e.key)).toEqual(["scorched-badge", "shard-log"]);
    expect(v.evidence.find((e) => e.key === "shard-log")?.provenance).toBe("given-by:balthazar");
    expect(v.factions.find((f) => f.key === "rustborn")?.reputation).toBe(10);
    expect(v.quests.find((q) => q.key === "ghost-courier")?.status).toBe("COMPLETED");
    expect(v.quests.find((q) => q.key === "follow-the-signal")?.status).toBe("ACTIVE");

    // 5. The Bazaar: Kira gives the friend price once Balthazar has vouched
    await run({ type: "travel", locationKey: "cyber-bazaar" });
    v = await view();
    expect(objectiveDone(v, "follow-the-signal", "enter-bazaar")).toBe(true);
    expect(v.npcsHere.map((n) => n.key).sort()).toEqual(["kira", "vex-404"]);
    expect(v.npcsHere.find((n) => n.key === "kira")?.offers[0]).toMatchObject({ price: 120, discounted: false });

    await run({ type: "talk", npcKey: "kira", message: "Balthazar sent me." });
    v = await view();
    expect(v.npcsHere.find((n) => n.key === "kira")?.offers[0]).toMatchObject({ price: 95, discounted: true });

    await run({ type: "investigate" });
    const purchase = await run({ type: "buy", npcKey: "kira", itemKey: "signal-decoder" });
    expect(purchase.outcomes.map((o) => o.text)).toEqual(expect.arrayContaining(["−95 credits", "Received: Signal Decoder", "Quest complete: Follow the Signal", "+60 credits"]));

    // 6. Everything is in the database: a fresh view after the fact shows the same save game
    v = await view();
    expect(v.world.credits).toBe(230 - 95 + 60);
    expect(v.quests.filter((q) => q.status === "COMPLETED").map((q) => q.key).sort()).toEqual(["follow-the-signal", "ghost-courier"]);
    expect(v.quests.find((q) => q.key === "project-genesis")?.status).toBe("ACTIVE"); // the next chapter
    expect(v.evidence.map((e) => e.key)).toContain("transit-record");
    expect(v.events.map((e) => e.title)).toEqual(expect.arrayContaining(["The signal points to Aether Tower", "Word travels in the Slums", "Investigation opened"]));

    const chat = await getConversation(testPrisma, session.id, user.id, "kira", { id: "mock", model: "deterministic-script-v1", isSimulated: true });
    expect(chat.messages.map((m) => m.role)).toEqual(["PLAYER", "NPC"]);
    expect(chat.messages[1]).toMatchObject({ isSimulated: true });
    expect(chat.messages[1].content).toMatch(/friend price/);
  });

  it("records every NPC turn as an agent run with its steps and validated tool calls", async () => {
    const { session, run } = await newGame();
    const result = await run({ type: "talk", npcKey: "balthazar", message: "Need a hand?" });
    const agentRun = await testPrisma.agentRun.findUniqueOrThrow({
      where: { id: result.agentRunId },
      include: { steps: { orderBy: { index: "asc" } }, tools: true, messages: { orderBy: { createdAt: "asc" } } },
    });
    expect(agentRun).toMatchObject({ gameSessionId: session.id, provider: "mock", isSimulated: true, status: "SUCCEEDED" });
    expect(agentRun.steps.map((s) => s.node)).toEqual([
      "validate_request",
      "load_state",
      "build_npc_context",
      "retrieve_memories",
      "interpret",
      "plan",
      "policy_check",
      "execute",
      "respond",
      "consolidate_memory",
      "finalize",
    ]);
    expect(agentRun.tools.map((t) => [t.toolName, t.status])).toEqual([["update_quest", "EXECUTED"]]);
    expect(agentRun.messages.map((m) => [m.role, m.isSimulated])).toEqual([
      ["PLAYER", false],
      ["NPC", true],
    ]);
  });
});
