import { createHash } from "node:crypto";
import type { TransactionClient } from "../prisma-client";
import { objectiveId, type SessionContext } from "./context";
import { BOUNDS, clamp, type Effect, type EffectOutcome } from "./effects";

/** Who caused an effect. NPC-sourced effects must already have passed `checkProposal` (policy.ts). */
export type EffectSource = { kind: "engine" } | { kind: "npc"; npcKey: string };

export type AppliedOutcome = EffectOutcome & { text?: string };

const MAX_DEPTH = 3; // objective → its completion effects → … never loops forever

/**
 * The single place where game state changes. Each effect is checked against the current state,
 * written in the caller's transaction, and mirrored into `ctx.state` for the checks that follow.
 * Effects that can't apply (already owned, already discovered, …) are skipped with a reason rather
 * than failing the whole command; checks that must fail a command (not enough credits for a
 * purchase, …) are done by the command before it produces effects.
 */
export async function applyEffects(
  tx: TransactionClient,
  ctx: SessionContext,
  effects: Effect[],
  source: EffectSource,
  depth = 0,
): Promise<AppliedOutcome[]> {
  const outcomes: AppliedOutcome[] = [];
  for (const effect of effects) {
    outcomes.push(...(await applyOne(tx, ctx, effect, source, depth)));
  }
  return outcomes;
}

async function applyOne(tx: TransactionClient, ctx: SessionContext, effect: Effect, source: EffectSource, depth: number): Promise<AppliedOutcome[]> {
  const { content, state, sessionId } = ctx;
  const skip = (reason: string): AppliedOutcome[] => [{ effect, status: "skipped", reason }];
  const done = (text: string, note?: string): AppliedOutcome[] => [{ effect, status: "applied", text, ...(note ? { note } : {}) }];

  switch (effect.type) {
    case "credits": {
      const next = state.credits + effect.delta;
      if (next < 0) return skip("not enough credits");
      await tx.worldState.update({ where: { gameSessionId: sessionId }, data: { credits: next } });
      state.credits = next;
      return done(`${effect.delta >= 0 ? "+" : "−"}${Math.abs(effect.delta)} credits`);
    }

    case "item_grant": {
      const item = content.items.get(effect.itemKey);
      if (!item) return skip(`unknown item ${effect.itemKey}`);
      const owned = state.inventory.get(item.key) ?? 0;
      if (owned > 0 && !item.stackable) return skip(`${item.name} is already in the inventory`);
      await tx.inventoryItem.upsert({
        where: { gameSessionId_itemDefinitionId: { gameSessionId: sessionId, itemDefinitionId: item.id } },
        create: { gameSessionId: sessionId, itemDefinitionId: item.id, quantity: effect.quantity, source: effect.source },
        update: { quantity: { increment: effect.quantity } },
      });
      state.inventory.set(item.key, owned + effect.quantity);
      return done(`Received: ${item.name}${effect.quantity > 1 ? ` ×${effect.quantity}` : ""}`);
    }

    case "item_remove": {
      const item = content.items.get(effect.itemKey);
      const owned = item ? (state.inventory.get(item.key) ?? 0) : 0;
      if (!item || owned < effect.quantity) return skip(`not enough ${item?.name ?? effect.itemKey}`);
      const where = { gameSessionId_itemDefinitionId: { gameSessionId: sessionId, itemDefinitionId: item.id } };
      if (owned === effect.quantity) {
        await tx.inventoryItem.delete({ where });
        state.inventory.delete(item.key);
      } else {
        await tx.inventoryItem.update({ where, data: { quantity: { decrement: effect.quantity } } });
        state.inventory.set(item.key, owned - effect.quantity);
      }
      return done(`Handed over: ${item.name}`);
    }

    case "evidence": {
      const evidence = content.evidence.get(effect.evidenceKey);
      if (!evidence) return skip(`unknown evidence ${effect.evidenceKey}`);
      if (state.evidence.has(evidence.key)) return skip("already discovered");
      await tx.discoveredEvidence.create({ data: { gameSessionId: sessionId, evidenceId: evidence.id, provenance: effect.provenance } });
      state.evidence.add(evidence.key);
      return done(`New evidence: ${evidence.title}`);
    }

    case "trust":
    case "suspicion": {
      const npc = content.npcs.get(effect.npcKey);
      const rel = npc && state.relationships.get(npc.key);
      if (!npc || !rel) return skip(`unknown NPC ${effect.npcKey}`);
      const field = effect.type;
      const next = clamp(rel[field] + effect.delta, BOUNDS[field]);
      if (next === rel[field]) return skip(`${field} is already at its limit`);
      await tx.nPCRelationship.update({
        where: { gameSessionId_npcId: { gameSessionId: sessionId, npcId: npc.id } },
        data: { [field]: next },
      });
      const moved = next - rel[field];
      rel[field] = next;
      const words = field === "trust" ? (moved > 0 ? "trusts you more" : "trusts you less") : moved > 0 ? "grows more suspicious" : "relaxes a little";
      return done(`${npc.name} ${words}`);
    }

    case "alert": {
      const next = clamp(state.alert + effect.delta, BOUNDS.alert);
      if (next === state.alert) return skip(effect.delta > 0 ? "security alert is already at maximum" : "security alert is already at zero");
      await tx.worldState.update({ where: { gameSessionId: sessionId }, data: { securityAlert: next } });
      state.alert = next;
      return done(`Security alert ${effect.delta > 0 ? "raised" : "lowered"} to ${next}/5`);
    }

    case "faction": {
      const faction = content.factions.get(effect.factionKey);
      if (!faction) return skip(`unknown faction ${effect.factionKey}`);
      const current = state.reputations.get(faction.key) ?? 0;
      const next = clamp(current + effect.delta, BOUNDS.reputation);
      if (next === current) return skip("reputation is already at its limit");
      await tx.factionReputation.upsert({
        where: { gameSessionId_factionId: { gameSessionId: sessionId, factionId: faction.id } },
        create: { gameSessionId: sessionId, factionId: faction.id, reputation: next },
        update: { reputation: next },
      });
      state.reputations.set(faction.key, next);
      return done(`${faction.name} reputation ${next > current ? "+" : "−"}${Math.abs(next - current)}`);
    }

    case "unlock_location": {
      const location = content.locations.get(effect.locationKey);
      if (!location) return skip(`unknown location ${effect.locationKey}`);
      if (state.unlocked.has(location.key)) return skip("already unlocked");
      await tx.locationAccess.create({ data: { gameSessionId: sessionId, locationId: location.id } });
      state.unlocked.add(location.key);
      return done(`Unlocked: ${location.name}`);
    }

    case "quest_start": {
      const quest = content.quests.get(effect.questKey);
      if (!quest) return skip(`unknown quest ${effect.questKey}`);
      if (state.questStatus.has(quest.key)) return skip("quest already started");
      if (quest.requiresQuestKey && state.questStatus.get(quest.requiresQuestKey) !== "COMPLETED") return skip("an earlier quest isn't finished yet");
      await tx.questState.create({ data: { gameSessionId: sessionId, questId: quest.id } });
      state.questStatus.set(quest.key, "ACTIVE");
      return done(`New quest: ${quest.title}`);
    }

    case "objective": {
      const quest = content.quests.get(effect.questKey);
      const objective = quest?.objectives.find((o) => o.key === effect.objectiveKey);
      if (!quest || !objective) return skip("unknown objective");
      if (state.questStatus.get(quest.key) !== "ACTIVE") return skip("quest is not active");
      const id = objectiveId(quest.key, objective.key);
      if (state.objectivesDone.has(id)) return skip("objective already complete");
      // Objectives the engine can verify from state are only completed by the engine itself
      if (objective.kind === "ASK_ABOUT" && !state.evidence.has(objective.targetKey)) return skip("the player doesn't have that evidence");
      if (objective.kind === "DELIVER_ITEM" && source.kind !== "engine") return skip("deliveries are completed by the engine");
      if (["TALK_TO", "VISIT_LOCATION", "DISCOVER_EVIDENCE", "COLLECT_ITEM"].includes(objective.kind) && source.kind !== "engine") {
        return skip("this objective is completed by the engine from game state");
      }
      if (depth >= MAX_DEPTH) return skip("effect chain too deep");
      await tx.objectiveProgress.create({ data: { gameSessionId: sessionId, objectiveId: objective.id } });
      state.objectivesDone.add(id);
      const follow = await applyEffects(tx, ctx, objective.completionEffects, { kind: "engine" }, depth + 1);
      return [{ effect, status: "applied", text: `Objective complete: ${objective.description.replace(/^Optional: /, "")}` }, ...follow];
    }

    case "world_event": {
      if (effect.key && state.worldEventKeys.has(effect.key)) return skip("this event already happened");
      const actorNpcId = source.kind === "npc" ? content.npcs.get(source.npcKey)?.id : undefined;
      await tx.worldEvent.create({
        data: {
          gameSessionId: sessionId,
          key: effect.key ?? null,
          title: effect.title,
          description: effect.description,
          severity: effect.severity,
          actor: source.kind === "npc" ? "NPC" : "SYSTEM",
          actorNpcId: actorNpcId ?? null,
          turn: state.turn,
        },
      });
      if (effect.key) state.worldEventKeys.add(effect.key);
      return done(effect.title);
    }

    case "memory": {
      const npc = content.npcs.get(effect.npcKey);
      if (!npc) return skip(`unknown NPC ${effect.npcKey}`);
      const contentHash = createHash("sha256").update(effect.content.trim().toLowerCase().replace(/\s+/g, " ")).digest("hex");
      const created = await tx.nPCMemory.createMany({
        data: [
          {
            gameSessionId: sessionId,
            npcId: npc.id,
            kind: effect.kind,
            content: effect.content,
            importance: effect.importance,
            contentHash,
            provenance: source.kind === "npc" ? `npc:${source.npcKey}:turn:${state.turn}` : `engine:turn:${state.turn}`,
          },
        ],
        skipDuplicates: true,
      });
      if (created.count === 0) return skip("already remembered");
      return done(`${npc.name} will remember this`);
    }
  }
}
