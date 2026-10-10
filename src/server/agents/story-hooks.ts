import { objectiveId, type SessionContext } from "../engine/context";
import type { ToolCall } from "./tools";

/**
 * Story rules computed from the game state. "Required" calls keep the game playable whatever the
 * model says (the quest giver always offers a quest on first contact); "hints" tell the model what
 * would make sense now, and it decides. Both still go through the normal tool checks.
 */
/** The evidence's main noun ("badge" for "Scorched Courier Badge"), or its full title */
function mentions(message: string, title: string) {
  const text = message.toLowerCase();
  const noun = title.toLowerCase().split(/\s+/).at(-1) ?? "";
  return text.includes(title.toLowerCase()) || (noun.length > 3 && new RegExp(`\\b${noun}s?\\b`).test(text));
}

export function storyHooks(ctx: SessionContext, npcKey: string, message = ""): { required: ToolCall[]; hints: string[] } {
  const required: ToolCall[] = [];
  const hints: string[] = [];
  const { state, content } = ctx;

  // Friend prices: the NPC knows its threshold; whether the player earned it is the model's call
  const npc = content.npcs.get(npcKey);
  const trust = state.relationships.get(npcKey)?.trust ?? 0;
  for (const offer of npc?.offers ?? []) {
    if (offer.discountPrice !== null && offer.discountMinTrust !== null && trust < offer.discountMinTrust) {
      hints.push(
        `Your friend price for the ${offer.itemDefinition.name} (${offer.discountPrice} instead of ${offer.price} credits) needs trust ${offer.discountMinTrust}; yours is ${trust}. If the player gives you a real reason to trust them (by your rules), raise trust with change_trust.`,
      );
    }
  }

  for (const quest of content.quests.values()) {
    const status = state.questStatus.get(quest.key);
    if (quest.giver?.key === npcKey && !status && !quest.autoStart && (!quest.requiresQuestKey || state.questStatus.get(quest.requiresQuestKey) === "COMPLETED")) {
      required.push({ tool: "update_quest", args: { action: "start", questKey: quest.key }, source: "story-rule" });
      hints.push(`Offer the player the job "${quest.title}" [questKey: ${quest.key}] (it starts automatically): ${quest.summary}`);
    }
    if (status !== "ACTIVE") continue;
    for (const o of quest.objectives) {
      if (state.objectivesDone.has(objectiveId(quest.key, o.key))) continue;
      if (o.kind === "ASK_ABOUT" && o.recipientKey === npcKey && state.evidence.has(o.targetKey)) {
        const evidence = content.evidence.get(o.targetKey)!;
        // The player holds the evidence and brings it up: that is the objective, whatever the model decides
        if (mentions(message, evidence.title)) {
          required.push({ tool: "update_quest", args: { action: "complete_objective", questKey: quest.key, objectiveKey: o.key }, source: "story-rule" });
        }
        hints.push(
          `If the player shows or asks about "${evidence.title}", react to it and call update_quest {"action":"complete_objective","questKey":"${quest.key}","objectiveKey":"${o.key}"}.`,
        );
      }
      if (o.kind === "DELIVER_ITEM" && o.recipientKey === npcKey) {
        const item = content.items.get(o.targetKey)!;
        hints.push(state.inventory.has(item.key) ? `The player carries the ${item.name} you need; ask them to hand it over.` : `You are waiting for the ${item.name}.`);
      }
    }
  }
  return { required, hints };
}
