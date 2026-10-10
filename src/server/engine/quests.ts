import type { TransactionClient } from "../prisma-client";
import { applyEffects, type AppliedOutcome } from "./apply";
import { objectiveId, type PlayerState, type ScenarioContent, type SessionContext } from "./context";

type Objective = ScenarioContent["quests"] extends Map<string, infer Q> ? (Q extends { objectives: (infer O)[] } ? O : never) : never;

/** Objectives that follow from state alone. TALK_TO also counts conversations from before the quest. */
export function isSatisfiedByState(objective: Objective, state: PlayerState): boolean {
  switch (objective.kind) {
    case "TALK_TO":
      return state.talkedTo.has(objective.targetKey);
    case "VISIT_LOCATION":
      return state.visited.has(objective.targetKey);
    case "DISCOVER_EVIDENCE":
      return state.evidence.has(objective.targetKey);
    case "COLLECT_ITEM":
      return (state.inventory.get(objective.targetKey) ?? 0) > 0;
    case "TRUST_AT_LEAST":
      return (state.relationships.get(objective.targetKey)?.trust ?? -Infinity) >= (objective.threshold ?? Infinity);
    default:
      return false; // DELIVER_ITEM and ASK_ABOUT are completed by commands and dialogue
  }
}

const MAX_PASSES = 5;

/**
 * Brings quests up to date with the state: completes satisfied objectives, completes quests whose
 * required objectives are done (reward once, guarded by `rewardGrantedAt` in the same transaction),
 * and starts follow-up quests. Repeats until nothing changes, at most a few passes.
 */
export async function evaluateQuests(tx: TransactionClient, ctx: SessionContext): Promise<AppliedOutcome[]> {
  const outcomes: AppliedOutcome[] = [];
  const { content, state, sessionId } = ctx;

  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let changed = false;

    for (const quest of content.quests.values()) {
      if (state.questStatus.get(quest.key) !== "ACTIVE") continue;

      for (const objective of quest.objectives) {
        if (state.objectivesDone.has(objectiveId(quest.key, objective.key))) continue;
        if (!isSatisfiedByState(objective, state)) continue;
        outcomes.push(...(await applyEffects(tx, ctx, [{ type: "objective", questKey: quest.key, objectiveKey: objective.key }], { kind: "engine" })));
        changed = true;
      }

      const required = quest.objectives.filter((o) => !o.optional);
      if (!required.every((o) => state.objectivesDone.has(objectiveId(quest.key, o.key)))) continue;

      // Only the transaction that flips rewardGrantedAt from null grants the reward
      const claimed = await tx.questState.updateMany({
        where: { gameSessionId: sessionId, questId: quest.id, status: "ACTIVE", rewardGrantedAt: null },
        data: { status: "COMPLETED", completedAt: new Date(), rewardGrantedAt: new Date() },
      });
      if (claimed.count !== 1) continue;
      state.questStatus.set(quest.key, "COMPLETED");
      outcomes.push({ effect: { type: "quest_start", questKey: quest.key }, status: "applied", text: `Quest complete: ${quest.title}` });

      const rewards = [
        ...(quest.rewardCredits > 0 ? [{ type: "credits" as const, delta: quest.rewardCredits }] : []),
        ...(quest.rewardItemKey ? [{ type: "item_grant" as const, itemKey: quest.rewardItemKey, quantity: 1, source: `reward:${quest.key}` }] : []),
      ];
      outcomes.push(...(await applyEffects(tx, ctx, [...rewards, ...quest.completionEffects], { kind: "engine" })));
      changed = true;
    }

    // Follow-up quests that start on their own
    for (const quest of content.quests.values()) {
      if (!quest.autoStart || state.questStatus.has(quest.key)) continue;
      if (quest.requiresQuestKey && state.questStatus.get(quest.requiresQuestKey) !== "COMPLETED") continue;
      outcomes.push(...(await applyEffects(tx, ctx, [{ type: "quest_start", questKey: quest.key }], { kind: "engine" })));
      changed = true;
    }

    if (!changed) break;
  }
  return outcomes;
}
