import { z } from "zod";
import { objectiveId, type PlayerState } from "./context";
import { MEMORY_KINDS } from "./effects";

/**
 * Conditions on the game state, as data. NPC intentions (the simulation), choices and endings all
 * use them; they are evaluated by the engine against server-side state only.
 */
const key = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/);

export const conditionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("quest"), questKey: key, status: z.enum(["NOT_STARTED", "ACTIVE", "COMPLETED"]) }),
  z.object({ type: z.literal("objective"), questKey: key, objectiveKey: key, done: z.boolean().default(true) }),
  z.object({ type: z.literal("evidence"), evidenceKey: key, has: z.boolean().default(true) }),
  z.object({ type: z.literal("item"), itemKey: key, has: z.boolean().default(true) }),
  z.object({ type: z.literal("alert_at_least"), value: z.number().int().min(0).max(5) }),
  z.object({ type: z.literal("alert_below"), value: z.number().int().min(0).max(6) }),
  z.object({ type: z.literal("trust_at_least"), npcKey: key, value: z.number().int() }),
  z.object({ type: z.literal("trust_below"), npcKey: key, value: z.number().int() }),
  z.object({ type: z.literal("suspicion_at_least"), npcKey: key, value: z.number().int() }),
  z.object({ type: z.literal("reputation_at_least"), factionKey: key, value: z.number().int() }),
  z.object({ type: z.literal("memory_kind"), npcKey: key, kind: z.enum(MEMORY_KINDS) }),
  z.object({ type: z.literal("world_event"), key, happened: z.boolean().default(true) }),
  z.object({ type: z.literal("choice"), choiceKey: key, option: key.optional(), offered: z.boolean().optional() }),
  z.object({ type: z.literal("location_visited"), locationKey: key }),
  z.object({ type: z.literal("tick_at_least"), value: z.number().int().min(0) }),
]);
export type Condition = z.infer<typeof conditionSchema>;
export const conditionListSchema = z.array(conditionSchema).max(12);

/** Extra state the conditions need beyond PlayerState. */
export type ConditionState = PlayerState & {
  tick: number;
  memoryKinds: ReadonlyMap<string, ReadonlySet<string>>;
  choices: ReadonlyMap<string, string | null>;
};

export function holds(c: Condition, s: ConditionState): boolean {
  switch (c.type) {
    case "quest": {
      const status = s.questStatus.get(c.questKey);
      return c.status === "NOT_STARTED" ? !status : status === c.status;
    }
    case "objective":
      return s.objectivesDone.has(objectiveId(c.questKey, c.objectiveKey)) === c.done;
    case "evidence":
      return s.evidence.has(c.evidenceKey) === c.has;
    case "item":
      return (s.inventory.get(c.itemKey) ?? 0) > 0 === c.has;
    case "alert_at_least":
      return s.alert >= c.value;
    case "alert_below":
      return s.alert < c.value;
    case "trust_at_least":
      return (s.relationships.get(c.npcKey)?.trust ?? -Infinity) >= c.value;
    case "trust_below":
      return (s.relationships.get(c.npcKey)?.trust ?? Infinity) < c.value;
    case "suspicion_at_least":
      return (s.relationships.get(c.npcKey)?.suspicion ?? -Infinity) >= c.value;
    case "reputation_at_least":
      return (s.reputations.get(c.factionKey) ?? 0) >= c.value;
    case "memory_kind":
      return s.memoryKinds.get(c.npcKey)?.has(c.kind) ?? false;
    case "world_event":
      return s.worldEventKeys.has(c.key) === c.happened;
    case "choice": {
      const made = s.choices.get(c.choiceKey);
      if (c.offered !== undefined) return s.choices.has(c.choiceKey) === c.offered;
      if (c.option) return made === c.option;
      return made !== undefined && made !== null;
    }
    case "location_visited":
      return s.visited.has(c.locationKey);
    case "tick_at_least":
      return s.tick >= c.value;
  }
}

export const allHold = (conditions: Condition[], s: ConditionState) => conditions.every((c) => holds(c, s));
