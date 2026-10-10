import { objectiveId, type SessionContext } from "../engine/context";
import type { ToolCall } from "./tools";

/**
 * Story rules computed from the game state. "Required" calls keep the game playable whatever the
 * model says (the quest giver always offers a quest on first contact); "hints" tell the model what
 * would make sense now, and it decides. Both still go through the normal tool checks.
 */
export function storyHooks(ctx: SessionContext, npcKey: string): { required: ToolCall[]; hints: string[] } {
  const required: ToolCall[] = [];
  const hints: string[] = [];
  const { state, content } = ctx;

  for (const quest of content.quests.values()) {
    const status = state.questStatus.get(quest.key);
    if (quest.giver?.key === npcKey && !status && !quest.autoStart && (!quest.requiresQuestKey || state.questStatus.get(quest.requiresQuestKey) === "COMPLETED")) {
      required.push({ tool: "update_quest", args: { action: "start", questKey: quest.key }, source: "story-rule" });
      hints.push(`Offer the player the job "${quest.title}" (it starts automatically): ${quest.summary}`);
    }
    if (status !== "ACTIVE") continue;
    for (const o of quest.objectives) {
      if (state.objectivesDone.has(objectiveId(quest.key, o.key))) continue;
      if (o.kind === "ASK_ABOUT" && o.recipientKey === npcKey && state.evidence.has(o.targetKey)) {
        const evidence = content.evidence.get(o.targetKey)!;
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
