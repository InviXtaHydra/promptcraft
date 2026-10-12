import { z } from "zod";
import { TOOL_NAMES } from "@/server/agents/tool-names";
import { conditionListSchema } from "@/server/engine/conditions";
import { BOUNDS, EFFECT_TYPES, effectListSchema } from "@/server/engine/effects";

/**
 * The authored world as data. The seed script validates a scenario against this schema and checks
 * that every key it references exists before anything is written to the database.
 */

const key = z.string().regex(/^[a-z0-9][a-z0-9-]*$/);
const hex = z.string().regex(/^#[0-9a-f]{6}$/i);
// The same bounds as the engine and the database CHECK constraints
const trust = z.number().int().min(BOUNDS.trust.min).max(BOUNDS.trust.max);
const suspicion = z.number().int().min(BOUNDS.suspicion.min).max(BOUNDS.suspicion.max);

export const personaSchema = z.object({
  personality: z.string(),
  background: z.string(),
  voice: z.string(),
  goals: z.array(z.string()).min(1),
  knownFacts: z.array(z.string()),
  beliefs: z.array(z.string()),
  uncertainties: z.array(z.string()),
  secrets: z.array(z.object({ fact: z.string(), revealAtTrust: trust })),
  trustThresholds: z.record(z.string(), z.number().int()),
  behavioralRules: z.array(z.string()).min(1),
});

/** What a case file must contain to reach an ending. Empty conditions make a fallback ending. */
export const endingConditionsSchema = z.object({
  suspectKeys: z.array(key).default([]),
  /** Every one of these must be in the case file */
  requiredEvidence: z.array(key).default([]),
  /** From each group, at least one must be in the case file */
  anyOfEvidence: z.array(z.array(key).min(1)).default([]),
  /** A decision the player made during the investigation */
  choice: z.object({ choiceKey: key, option: key }).optional(),
});

export const scenarioSchema = z.object({
  slug: key,
  title: z.string(),
  summary: z.string(),
  version: z.number().int().positive(),
  startingCredits: z.number().int().nonnegative().max(1_000_000),
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
      unlockItemKeys: z.array(key).default([]),
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
      baseTrust: trust,
      baseSuspicion: suspicion,
      allowedEffects: z.array(z.enum(EFFECT_TYPES as [string, ...string[]])),
      allowedTools: z.array(z.enum(TOOL_NAMES)).default([]),
      persona: personaSchema,
      offers: z
        .array(
          z.object({
            itemKey: key,
            price: z.number().int().nonnegative(),
            discountPrice: z.number().int().nonnegative().optional(),
            discountMinTrust: trust.optional(),
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
            kind: z.enum(["TALK_TO", "VISIT_LOCATION", "DISCOVER_EVIDENCE", "COLLECT_ITEM", "DELIVER_ITEM", "ASK_ABOUT", "TRUST_AT_LEAST", "CLOSE_CASE"]),
            targetKey: key,
            recipientKey: key.optional(),
            threshold: z.number().int().optional(),
            optional: z.boolean().default(false),
            onCompleteEffects: effectListSchema.default([]),
          }),
        )
        .min(1),
    }),
  ),
  simulation: z
    .object({ everyTurns: z.number().int().min(1).max(50).default(3), maxActionsPerTick: z.number().int().min(0).max(10).default(2) })
    .default({ everyTurns: 3, maxActionsPerTick: 2 }),
  suspects: z.array(z.object({ key, name: z.string(), title: z.string(), description: z.string(), motive: z.string(), npcKey: key.optional() })).default([]),
  evidenceLinks: z
    .array(
      z.object({
        fromEvidenceKey: key,
        toEvidenceKey: key.optional(),
        toSuspectKey: key.optional(),
        relation: z.enum(["SUPPORTS", "CONTRADICTS", "LEADS_TO", "IMPLICATES", "EXONERATES"]),
        note: z.string(),
      }),
    )
    .default([]),
  choices: z
    .array(
      z.object({
        key,
        title: z.string(),
        prompt: z.string(),
        offeredByNpcKey: key.optional(),
        options: z.array(z.object({ key, label: z.string(), description: z.string(), effects: effectListSchema.default([]) })).min(2).max(4),
      }),
    )
    .default([]),
  intentions: z
    .array(
      z.object({
        key,
        actorType: z.enum(["npc", "faction"]),
        actorKey: key,
        goal: z.string(),
        title: z.string(),
        description: z.string(),
        conditions: conditionListSchema,
        effects: effectListSchema,
        once: z.boolean().default(true),
        cooldownTicks: z.number().int().min(0).max(100).default(0),
      }),
    )
    .default([]),
  endings: z
    .array(
      z.object({
        key,
        title: z.string(),
        description: z.string(),
        tone: z.enum(["triumph", "bittersweet", "dark", "neutral"]).default("neutral"),
        conditions: endingConditionsSchema,
        effects: effectListSchema.default([]),
      }),
    )
    .default([]),
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
  const sets2 = {
    suspect: new Set(s.suspects.map((x) => x.key)),
    choice: new Set(s.choices.map((x) => x.key)),
  };
  const needX = (kind: "suspect" | "choice", value: string | undefined, where: string) => {
    if (value !== undefined && !sets2[kind].has(value)) errors.push(`${where}: unknown ${kind} "${value}"`);
  };
  s.locations.forEach((l) => l.unlockItemKeys.forEach((i) => need("item", i, `location ${l.key} unlockItemKeys`)));
  s.suspects.forEach((x) => need("npc", x.npcKey, `suspect ${x.key}`));
  s.evidenceLinks.forEach((l, i) => {
    const where = `evidence link ${i + 1}`;
    need("evidence", l.fromEvidenceKey, where);
    need("evidence", l.toEvidenceKey, where);
    needX("suspect", l.toSuspectKey, where);
    if (!l.toEvidenceKey === !l.toSuspectKey) errors.push(`${where}: needs exactly one of toEvidenceKey or toSuspectKey`);
  });
  const conditionRefs = (conditions: z.infer<typeof conditionListSchema>, where: string) =>
    conditions.forEach((c) => {
      if ("questKey" in c) need("quest", c.questKey, where);
      if ("evidenceKey" in c) need("evidence", c.evidenceKey, where);
      if ("itemKey" in c) need("item", c.itemKey, where);
      if ("npcKey" in c) need("npc", c.npcKey, where);
      if ("factionKey" in c) need("faction", c.factionKey, where);
      if ("locationKey" in c) need("location", c.locationKey, where);
      if (c.type === "choice") needX("choice", c.choiceKey, where);
    });
  s.choices.forEach((c) => {
    need("npc", c.offeredByNpcKey, `choice ${c.key}`);
    c.options.forEach((o) => effectRefs(o.effects, `choice ${c.key} option ${o.key}`));
  });
  s.intentions.forEach((x) => {
    const where = `intention ${x.key}`;
    if (x.actorType === "npc") need("npc", x.actorKey, where);
    else need("faction", x.actorKey, where);
    conditionRefs(x.conditions, where);
    effectRefs(x.effects, where);
    x.effects.forEach((e) => e.type === "offer_choice" && needX("choice", e.choiceKey, where));
  });
  s.endings.forEach((e) => {
    const where = `ending ${e.key}`;
    e.conditions.suspectKeys.forEach((k) => needX("suspect", k, where));
    e.conditions.requiredEvidence.forEach((k) => need("evidence", k, where));
    e.conditions.anyOfEvidence.flat().forEach((k) => need("evidence", k, where));
    if (e.conditions.choice) {
      needX("choice", e.conditions.choice.choiceKey, where);
      const choice = s.choices.find((c) => c.key === e.conditions.choice!.choiceKey);
      if (choice && !choice.options.some((o) => o.key === e.conditions.choice!.option)) errors.push(`${where}: unknown option "${e.conditions.choice.option}"`);
    }
    effectRefs(e.effects, where);
  });
  if (s.endings.length && !s.endings.some((e) => !e.conditions.suspectKeys.length && !e.conditions.requiredEvidence.length && !e.conditions.anyOfEvidence.length && !e.conditions.choice)) {
    errors.push("endings need a fallback ending without conditions");
  }
  for (const [kind, list] of Object.entries({ suspect: s.suspects, choice: s.choices, intention: s.intentions, ending: s.endings })) {
    const keys = list.map((x) => x.key);
    const dup = keys.find((k, i) => keys.indexOf(k) !== i);
    if (dup) errors.push(`duplicate ${kind} key "${dup}"`);
  }
  s.quests.forEach((q) => {
    need("npc", q.giverNpcKey, `quest ${q.key}`);
    need("quest", q.requiresQuestKey, `quest ${q.key}`);
    need("item", q.rewardItemKey, `quest ${q.key}`);
    effectRefs(q.onCompleteEffects, `quest ${q.key}`);
    q.objectives.forEach((o) => {
      const where = `quest ${q.key} objective ${o.key}`;
      const kind = { TALK_TO: "npc", VISIT_LOCATION: "location", DISCOVER_EVIDENCE: "evidence", COLLECT_ITEM: "item", DELIVER_ITEM: "item", ASK_ABOUT: "evidence", TRUST_AT_LEAST: "npc", CLOSE_CASE: null } as const;
      if (kind[o.kind]) need(kind[o.kind]!, o.targetKey, where);
      if (o.kind === "TRUST_AT_LEAST" && o.threshold === undefined) errors.push(`${where}: TRUST_AT_LEAST needs a threshold`);
      need("npc", o.recipientKey, where);
      if ((o.kind === "DELIVER_ITEM" || o.kind === "ASK_ABOUT") && !o.recipientKey) errors.push(`${where}: ${o.kind} needs a recipientKey`);
      effectRefs(o.onCompleteEffects, where);
    });
  });
  return errors;
}
