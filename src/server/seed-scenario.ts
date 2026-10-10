import type { z } from "zod";
import { scenarioSchema, validateScenarioReferences } from "@/content/scenario-schema";
import type { PrismaClient } from "./prisma-client";

/**
 * Writes one scenario version and publishes it, in a single transaction. Used by `prisma db seed`
 * and by the integration tests. Returns without changes when this version already exists.
 */
export async function seedScenario(prisma: PrismaClient, input: z.input<typeof scenarioSchema>, options: { status?: "PUBLISHED" | "PREVIEW" } = {}) {
  const s = scenarioSchema.parse(input);
  const errors = validateScenarioReferences(s);
  if (errors.length) throw new Error(`Scenario "${s.slug}" is invalid:\n- ${errors.join("\n- ")}`);

  const existing = await prisma.scenarioVersion.findFirst({ where: { scenario: { slug: s.slug }, version: s.version } });
  if (existing) return { slug: s.slug, version: s.version, created: false, scenarioVersionId: existing.id };

  const scenarioVersionId = await prisma.$transaction(async (tx) => {
    const scenario = await tx.scenario.upsert({
      where: { slug: s.slug },
      create: { slug: s.slug, title: s.title, summary: s.summary },
      update: { title: s.title, summary: s.summary },
    });
    const version = await tx.scenarioVersion.create({
      data: {
        scenarioId: scenario.id,
        version: s.version,
        status: "DRAFT",
        startingCredits: s.startingCredits,
        startingItems: s.startingItems,
        definition: input as object,
        simulationEveryTurns: s.simulation.everyTurns,
        simulationMaxActions: s.simulation.maxActionsPerTick,
      },
    });
    const v = version.id;

    const factionIds = new Map<string, string>();
    for (const f of s.factions) {
      const row = await tx.faction.create({ data: { scenarioVersionId: v, key: f.key, name: f.name, description: f.description, accent: f.accent } });
      factionIds.set(f.key, row.id);
    }

    const itemIds = new Map<string, string>();
    for (const i of s.items) {
      const row = await tx.itemDefinition.create({
        data: { scenarioVersionId: v, key: i.key, name: i.name, description: i.description, kind: i.kind, rarity: i.rarity, baseValue: i.baseValue, stackable: i.stackable },
      });
      itemIds.set(i.key, row.id);
    }

    const locationIds = new Map<string, string>();
    for (const [index, l] of s.locations.entries()) {
      const row = await tx.location.create({
        data: {
          scenarioVersionId: v,
          key: l.key,
          name: l.name,
          district: l.district,
          description: l.description,
          ambience: l.ambience,
          accent: l.accent,
          sortOrder: index,
          isStartingPoint: l.isStartingPoint,
          startsUnlocked: l.startsUnlocked,
          lockedReason: l.lockedReason ?? null,
          unlockItemKeys: l.unlockItemKeys,
        },
      });
      locationIds.set(l.key, row.id);
      for (const loot of l.loot) {
        await tx.locationLoot.create({
          data: { locationId: row.id, itemDefinitionId: itemIds.get(loot.itemKey)!, quantity: loot.quantity, foundText: loot.foundText },
        });
      }
    }

    const npcIds = new Map<string, string>();
    for (const n of s.npcs) {
      const row = await tx.nPC.create({
        data: {
          scenarioVersionId: v,
          key: n.key,
          name: n.name,
          title: n.title,
          shortBio: n.shortBio,
          accent: n.accent,
          locationId: locationIds.get(n.locationKey)!,
          reachableFrom: n.reachableFrom,
          factionId: n.factionKey ? factionIds.get(n.factionKey)! : null,
          baseTrust: n.baseTrust,
          baseSuspicion: n.baseSuspicion,
          allowedEffects: n.allowedEffects,
          allowedTools: n.allowedTools,
          persona: n.persona,
        },
      });
      npcIds.set(n.key, row.id);
      for (const o of n.offers) {
        await tx.merchantOffer.create({
          data: {
            npcId: row.id,
            itemDefinitionId: itemIds.get(o.itemKey)!,
            price: o.price,
            discountPrice: o.discountPrice ?? null,
            discountMinTrust: o.discountMinTrust ?? null,
          },
        });
      }
    }

    for (const e of s.evidence) {
      await tx.evidence.create({
        data: {
          scenarioVersionId: v,
          key: e.key,
          title: e.title,
          description: e.description,
          locationId: e.locationKey ? locationIds.get(e.locationKey)! : null,
          sourceNpcId: e.sourceNpcKey ? npcIds.get(e.sourceNpcKey)! : null,
          reliability: e.reliability,
          tags: e.tags,
        },
      });
    }

    for (const [index, q] of s.quests.entries()) {
      await tx.quest.create({
        data: {
          scenarioVersionId: v,
          key: q.key,
          title: q.title,
          summary: q.summary,
          giverNpcId: q.giverNpcKey ? npcIds.get(q.giverNpcKey)! : null,
          sortOrder: index,
          isMain: q.isMain,
          requiresQuestKey: q.requiresQuestKey ?? null,
          autoStart: q.autoStart,
          rewardCredits: q.rewardCredits,
          rewardItemKey: q.rewardItemKey ?? null,
          rewardText: q.rewardText ?? null,
          onCompleteEffects: q.onCompleteEffects,
          objectives: {
            create: q.objectives.map((o, i) => ({
              key: o.key,
              description: o.description,
              kind: o.kind,
              targetKey: o.targetKey,
              recipientKey: o.recipientKey ?? null,
              threshold: o.threshold ?? null,
              optional: o.optional,
              sortOrder: i,
              onCompleteEffects: o.onCompleteEffects,
            })),
          },
        },
      });
    }

    for (const x of s.suspects) {
      await tx.suspect.create({ data: { scenarioVersionId: v, key: x.key, name: x.name, title: x.title, description: x.description, motive: x.motive, npcKey: x.npcKey ?? null } });
    }
    if (s.evidenceLinks.length) {
      await tx.evidenceLink.createMany({
        data: s.evidenceLinks.map((l) => ({ scenarioVersionId: v, fromEvidenceKey: l.fromEvidenceKey, toEvidenceKey: l.toEvidenceKey ?? null, toSuspectKey: l.toSuspectKey ?? null, relation: l.relation, note: l.note })),
      });
    }
    for (const c of s.choices) {
      await tx.choice.create({ data: { scenarioVersionId: v, key: c.key, title: c.title, prompt: c.prompt, offeredByNpcKey: c.offeredByNpcKey ?? null, options: c.options } });
    }
    for (const [index, x] of s.intentions.entries()) {
      await tx.npcIntention.create({
        data: {
          scenarioVersionId: v,
          key: x.key,
          actorType: x.actorType,
          actorKey: x.actorKey,
          goal: x.goal,
          title: x.title,
          description: x.description,
          conditions: x.conditions,
          effects: x.effects,
          once: x.once,
          cooldownTicks: x.cooldownTicks,
          sortOrder: index,
        },
      });
    }
    for (const [index, e] of s.endings.entries()) {
      await tx.ending.create({ data: { scenarioVersionId: v, key: e.key, title: e.title, description: e.description, priority: index, conditions: e.conditions, effects: e.effects, tone: e.tone } });
    }

    await tx.scenarioVersion.update({ where: { id: v }, data: { status: options.status ?? "PUBLISHED", publishedAt: (options.status ?? "PUBLISHED") === "PUBLISHED" ? new Date() : null } });
    return v;
  });

  return { slug: s.slug, version: s.version, created: true, scenarioVersionId };
}

