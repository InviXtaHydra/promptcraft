import { z } from "zod";

/**
 * Effects are the only way game state changes. Commands (travel, investigate, talk, …) and NPC
 * proposals produce effects; `applyEffects` validates each one against the authoritative state and
 * persists it. Keys refer to scenario content (`neon-slums`, `balthazar`, …), never to database ids,
 * so nothing a client or model sends can point at another player's rows.
 */

const key = z
  .string()
  .min(1)
  .max(64)
  .regex(/^[a-z0-9][a-z0-9-]*$/, "keys are lowercase words joined by hyphens");

export const MEMORY_KINDS = ["EPISODIC", "SEMANTIC", "RELATIONSHIP", "PROMISE", "BETRAYAL", "EVIDENCE", "NEGOTIATION"] as const;
export const SEVERITIES = ["INFO", "NOTICE", "WARNING", "CRITICAL"] as const;

export const effectSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("credits"), delta: z.number().int().min(-10_000).max(10_000) }),
  z.object({ type: z.literal("item_grant"), itemKey: key, quantity: z.number().int().min(1).max(99).default(1), source: z.string().min(1).max(80) }),
  z.object({ type: z.literal("item_remove"), itemKey: key, quantity: z.number().int().min(1).max(99).default(1) }),
  z.object({ type: z.literal("evidence"), evidenceKey: key, provenance: z.string().min(1).max(80) }),
  z.object({ type: z.literal("trust"), npcKey: key, delta: z.number().int().min(-50).max(50) }),
  z.object({ type: z.literal("suspicion"), npcKey: key, delta: z.number().int().min(-50).max(50) }),
  z.object({ type: z.literal("alert"), delta: z.number().int().min(-5).max(5) }),
  z.object({ type: z.literal("faction"), factionKey: key, delta: z.number().int().min(-50).max(50) }),
  z.object({ type: z.literal("unlock_location"), locationKey: key }),
  z.object({ type: z.literal("quest_start"), questKey: key }),
  z.object({ type: z.literal("objective"), questKey: key, objectiveKey: key }),
  z.object({
    type: z.literal("world_event"),
    key: key.optional(),
    title: z.string().min(1).max(120),
    description: z.string().min(1).max(600),
    severity: z.enum(SEVERITIES).default("INFO"),
  }),
  z.object({
    type: z.literal("memory"),
    npcKey: key,
    kind: z.enum(MEMORY_KINDS),
    content: z.string().min(1).max(500),
    importance: z.number().int().min(1).max(10),
  }),
]);

export type Effect = z.infer<typeof effectSchema>;
export type EffectInput = z.input<typeof effectSchema>;
export type EffectType = Effect["type"];
export const EFFECT_TYPES = effectSchema.options.map((o) => o.shape.type.value) as EffectType[];

export const effectListSchema = z.array(effectSchema).max(20);

/** What the engine reports back for each effect: applied (possibly adjusted) or skipped, and why. */
export type EffectOutcome =
  | { effect: Effect; status: "applied"; note?: string }
  | { effect: Effect; status: "skipped"; reason: string };

// Bounds of the world, shared with the database CHECK constraints in the first migration.
export const BOUNDS = {
  trust: { min: -100, max: 100 },
  suspicion: { min: 0, max: 100 },
  reputation: { min: -100, max: 100 },
  alert: { min: 0, max: 5 },
} as const;

export function clamp(value: number, { min, max }: { min: number; max: number }) {
  return Math.max(min, Math.min(max, value));
}
