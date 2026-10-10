import type { SessionContext } from "./context";
import { effectSchema, type Effect } from "./effects";

/**
 * What an NPC (today the mock, from Phase 2 a language model) may propose. Every proposal is checked
 * here before it reaches `applyEffects`; anything outside the NPC's permissions is rejected and
 * recorded as a rejected tool call.
 */
export type ProposalCheck = { ok: true; effect: Effect } | { ok: false; reason: string; raw: unknown };

const MAX_PROPOSALS_PER_TURN = 6;

export function checkProposals(ctx: SessionContext, npcKey: string, proposals: unknown[]): ProposalCheck[] {
  const npc = ctx.content.npcs.get(npcKey);
  if (!npc) return proposals.map((raw) => ({ ok: false, reason: "unknown NPC", raw }));
  let alertRaised = false;

  return proposals.map((raw, index): ProposalCheck => {
    if (index >= MAX_PROPOSALS_PER_TURN) return { ok: false, reason: `more than ${MAX_PROPOSALS_PER_TURN} proposals in one turn`, raw };
    const parsed = effectSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, reason: `malformed: ${parsed.error.issues[0]?.message ?? "invalid"}`, raw };
    const effect = parsed.data;
    if (!npc.allowedEffects.includes(effect.type)) return { ok: false, reason: `${npc.name} may not use ${effect.type}`, raw };

    switch (effect.type) {
      case "trust":
      case "suspicion":
      case "memory":
        // NPCs only change and remember their own relationship with the player
        if (effect.npcKey !== npc.key) return { ok: false, reason: "an NPC can only change its own relationship and memories", raw };
        return { ok: true, effect };
      case "quest_start": {
        const quest = ctx.content.quests.get(effect.questKey);
        if (!quest || quest.giver?.key !== npc.key) return { ok: false, reason: "an NPC can only hand out its own quests", raw };
        return { ok: true, effect };
      }
      case "objective": {
        const objective = ctx.content.quests.get(effect.questKey)?.objectives.find((o) => o.key === effect.objectiveKey);
        if (!objective || objective.kind !== "ASK_ABOUT" || objective.recipientKey !== npc.key) {
          return { ok: false, reason: "an NPC can only complete 'ask about' objectives addressed to it", raw };
        }
        return { ok: true, effect };
      }
      case "evidence": {
        const evidence = ctx.content.evidence.get(effect.evidenceKey);
        if (!evidence || evidence.sourceNpcId !== npc.id) return { ok: false, reason: "an NPC can only hand over evidence it holds", raw };
        return { ok: true, effect };
      }
      case "alert":
        if (effect.delta > 1 || alertRaised) return { ok: false, reason: "the alert can rise at most one level per turn", raw };
        if (effect.delta < 0) return { ok: false, reason: "NPCs can't lower the security alert", raw };
        alertRaised = true;
        return { ok: true, effect };
      case "faction":
        if (!npc.factionId || ctx.content.factions.get(effect.factionKey)?.id !== npc.factionId) {
          return { ok: false, reason: "an NPC can only change its own faction's reputation", raw };
        }
        if (Math.abs(effect.delta) > 10) return { ok: false, reason: "reputation changes by at most 10 per turn", raw };
        return { ok: true, effect };
      case "world_event":
        return { ok: true, effect };
      case "offer_choice": {
        const choice = ctx.content.choices.get(effect.choiceKey);
        if (!choice || choice.offeredByNpcKey !== npc.key) return { ok: false, reason: "an NPC can only put its own decisions to the player", raw };
        return { ok: true, effect };
      }
      default:
        // credits, items, locations: only commands handled by the engine itself
        return { ok: false, reason: `${effect.type} is reserved for the game engine`, raw };
    }
  });
}
