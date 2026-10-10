import { z } from "zod";
import { EFFECT_TYPES, effectListSchema } from "@/server/engine/effects";

/**
 * The authored world as data. The seed script validates a scenario against this schema and checks
 * that every key it references exists before anything is written to the database.
 */

const key = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
const hex = z.string().regex(/^#[0-9a-f]{6}$/i);

export const personaSchema = z.object({
  personality: z.string(),
  background: z.string(),
  voice: z.string(),
  goals: z.array(z.string()).min(1),
  knownFacts: z.array(z.string()),
  beliefs: z.array(z.string()),
  uncertainties: z.array(z.string()),
  secrets: z.array(z.object({ fact: z.string(), revealAtTrust: z.number().int() })),
  trustThresholds: z.record(z.string(), z.number().int()),
  behavioralRules: z.array(z.string()).min(1),
});

export const scenarioSchema = z.object({
  slug: key,
  title: z.string(),
  summary: z.string(),
  version: z.number().int().positive(),
  startingCredits: z.number().int().nonnegative(),
  startingItems: z.array(z.object({ itemKey: key, quantity: z.number().int().positive() })),
  factions: z.array(z.object({ key, name: z.string(), description: z.string(), accent: hex })),
  locations: z.array(
    z.object({
      key,
      name: z.string(),
      district: z.string(),
      description: z.string(),
      ambience: z.string(),
      accent: hex,
      isStartingPoint: z.boolean().default(false),
      startsUnlocked: z.boolean().default(false),
      lockedReason: z.string().optional(),
      loot: z.array(z.object({ itemKey: key, quantity: z.number().int().positive(), foundText: z.string() })).default([]),
    }),
  ),
  items: z.array(
    z.object({
      key,
      name: z.string(),
      description: z.string(),
      kind: z.enum(["TOOL", "DATA", "KEYCARD", "CONSUMABLE", "MISC"]),
      rarity: z.enum(["COMMON", "RARE", "EPIC", "LEGENDARY"]).default("COMMON"),
      baseValue: z.number().int().nonnegative(),
      stackable: z.boolean().default(false),
    }),
  ),
  npcs: z.array(
    z.object({
      key,
      name: z.string(),
      title: z.string(),
      shortBio: z.string(),
      accent: hex,
      locationKey: key,
      reachableFrom: z.array(key).default([]),
      factionKey: key.optional(),
      baseTrust: z.number().int(),
      baseSuspicion: z.number().int(),
      allowedEffects: z.array(z.enum(EFFECT_TYPES as [string, ...string[]])),
      persona: personaSchema,
      offers: z
        .array(
          z.object({
            itemKey: key,
            price: z.number().int().nonnegative(),
            discountPrice: z.number().int().nonnegative().optional(),
            discountMinTrust: z.number().int().optional(),
          }),
        )
        .default([]),
    }),
  ),
  evidence: z.array(
    z.object({
      key,
      title: z.string(),
      description: z.string(),
      locationKey: key.optional(),
      sourceNpcKey: key.optional(),
      reliability: z.enum(["CONFIRMED", "LIKELY", "UNVERIFIED", "DISPUTED"]),
      tags: z.array(z.string()).default([]),
    }),
  ),
  quests: z.array(
    z.object({
      key,
      title: z.string(),
      summary: z.string(),
      giverNpcKey: key.optional(),
      isMain: z.boolean().default(true),
      requiresQuestKey: key.optional(),
      autoStart: z.boolean().default(false),
      rewardCredits: z.number().int().nonnegative().default(0),
      rewardItemKey: key.optional(),
      rewardText: z.string().optional(),
      onCompleteEffects: effectListSchema.default([]),
      objectives: z
        .array(
          z.object({
            key,
            description: z.string(),
            kind: z.enum(["TALK_TO", "VISIT_LOCATION", "DISCOVER_EVIDENCE", "COLLECT_ITEM", "DELIVER_ITEM", "ASK_ABOUT"]),
            targetKey: key,
            recipientKey: key.optional(),
            optional: z.boolean().default(false),
            onCompleteEffects: effectListSchema.default([]),
          }),
        )
        .min(1),
    }),
  ),
});

export type ScenarioDefinition = z.output<typeof scenarioSchema>;

/** Cross-reference checks the schema can't express: every key must point at something that exists. */
export function validateScenarioReferences(s: ScenarioDefinition): string[] {
  const errors: string[] = [];
  const sets = {
    location: new Set(s.locations.map((l) => l.key)),
    item: new Set(s.items.map((i) => i.key)),
    npc: new Set(s.npcs.map((n) => n.key)),
    faction: new Set(s.factions.map((f) => f.key)),
    evidence: new Set(s.evidence.map((e) => e.key)),
    quest: new Set(s.quests.map((q) => q.key)),
  };
  const need = (kind: keyof typeof sets, value: string | undefined, where: string) => {
    if (value !== undefined && !sets[kind].has(value)) errors.push(`${where}: unknown ${kind} "${value}"`);
  };
  for (const [kind, list] of Object.entries({
    location: s.locations,
    item: s.items,
    npc: s.npcs,
    faction: s.factions,
    evidence: s.evidence,
    quest: s.quests,
  })) {
    const keys = list.map((x) => x.key);
    const dup = keys.find((k, i) => keys.indexOf(k) !== i);
    if (dup) errors.push(`duplicate ${kind} key "${dup}"`);
  }
  if (s.locations.filter((l) => l.isStartingPoint).length !== 1) errors.push("exactly one location must be the starting point");
  const start = s.locations.find((l) => l.isStartingPoint);
  if (start && !start.startsUnlocked) errors.push("the starting location must start unlocked");
  s.startingItems.forEach((i) => need("item", i.itemKey, "startingItems"));
  s.locations.forEach((l) => l.loot.forEach((x) => need("item", x.itemKey, `location ${l.key} loot`)));
  s.npcs.forEach((n) => {
    need("location", n.locationKey, `npc ${n.key}`);
    n.reachableFrom.forEach((r) => need("location", r, `npc ${n.key} reachableFrom`));
    need("faction", n.factionKey, `npc ${n.key}`);
    n.offers.forEach((o) => need("item", o.itemKey, `npc ${n.key} offer`));
  });
  s.evidence.forEach((e) => {
    need("location", e.locationKey, `evidence ${e.key}`);
    need("npc", e.sourceNpcKey, `evidence ${e.key}`);
  });
  const effectRefs = (effects: ScenarioDefinition["quests"][number]["onCompleteEffects"], where: string) =>
    effects.forEach((e) => {
      if ("itemKey" in e) need("item", e.itemKey, where);
      if ("evidenceKey" in e) need("evidence", e.evidenceKey, where);
      if ("npcKey" in e) need("npc", e.npcKey, where);
      if ("factionKey" in e) need("faction", e.factionKey, where);
      if ("locationKey" in e) need("location", e.locationKey, where);
      if ("questKey" in e) need("quest", e.questKey, where);
    });
  s.quests.forEach((q) => {
    need("npc", q.giverNpcKey, `quest ${q.key}`);
    need("quest", q.requiresQuestKey, `quest ${q.key}`);
    need("item", q.rewardItemKey, `quest ${q.key}`);
    effectRefs(q.onCompleteEffects, `quest ${q.key}`);
    q.objectives.forEach((o) => {
      const where = `quest ${q.key} objective ${o.key}`;
      const kind = { TALK_TO: "npc", VISIT_LOCATION: "location", DISCOVER_EVIDENCE: "evidence", COLLECT_ITEM: "item", DELIVER_ITEM: "item", ASK_ABOUT: "evidence" } as const;
      need(kind[o.kind], o.targetKey, where);
      need("npc", o.recipientKey, where);
      if ((o.kind === "DELIVER_ITEM" || o.kind === "ASK_ABOUT") && !o.recipientKey) errors.push(`${where}: ${o.kind} needs a recipientKey`);
      effectRefs(o.onCompleteEffects, where);
    });
  });
  return errors;
}
