import { randomBytes } from "node:crypto";
import type { z } from "zod";
import { scenarioSchema, validateScenarioReferences } from "@/content/scenario-schema";
import { TOOL_NAMES } from "../agents/tool-names";
import { EFFECT_TYPES } from "../engine/effects";
import type { CurrentUser } from "../auth";
import { createGameSession } from "../engine/sessions";
import { GameError, notFound, rejected } from "../errors";
import type { PrismaClient } from "../prisma-client";
import { materializeVersion } from "../seed-scenario";

/**
 * Creator Mode: scenarios as editable drafts. A draft is only a definition (JSON); it becomes
 * playable when it is validated and materialised, either as an isolated PREVIEW version for a
 * test run, or as a new PUBLISHED version. Published versions are immutable, so running save
 * games never change under a player.
 */

export function assertCreator(user: CurrentUser) {
  if (user.role !== "CREATOR" && user.role !== "ADMIN") throw new GameError(403, "creators_only", "Creator Mode is for creators. Ask an admin for the CREATOR role.");
}

const MAX_DEFINITION_BYTES = 400_000;

export type ValidationIssue = { path: string; message: string };

/** Schema validation with paths, then the cross-reference checks. */
export function validateDefinition(definition: unknown): { ok: boolean; issues: ValidationIssue[] } {
  const parsed = scenarioSchema.safeParse(definition);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues.slice(0, 50).map((i) => ({ path: i.path.join(".") || "(root)", message: i.message })) };
  }
  const refs = validateScenarioReferences(parsed.data);
  return { ok: refs.length === 0, issues: refs.map((message) => ({ path: message.split(":")[0], message })) };
}

async function ownDraft(prisma: PrismaClient, user: CurrentUser, versionId: string) {
  const version = await prisma.scenarioVersion.findFirst({ where: { id: versionId, status: "DRAFT", scenario: { authorId: user.id } }, include: { scenario: true } });
  if (!version) throw notFound("Draft");
  return version;
}

export async function listCreatorScenarios(prisma: PrismaClient, user: CurrentUser) {
  const [mine, published] = await Promise.all([
    prisma.scenario.findMany({
      where: { authorId: user.id },
      orderBy: { updatedAt: "desc" },
      include: { versions: { orderBy: { version: "desc" }, select: { id: true, version: true, status: true, createdAt: true } } },
    }),
    prisma.scenario.findMany({ where: { versions: { some: { status: "PUBLISHED" } } }, select: { slug: true, title: true } }),
  ]);
  return {
    mine: mine.map((s) => ({
      slug: s.slug,
      title: s.title,
      draftId: s.versions.find((v) => v.status === "DRAFT")?.id ?? null,
      published: s.versions.filter((v) => v.status === "PUBLISHED").map((v) => v.version),
      previews: s.versions.filter((v) => v.status === "PREVIEW").length,
    })),
    forkable: published,
  };
}

/** Copies the latest published version of a scenario into a new draft owned by the creator. */
export async function forkScenario(prisma: PrismaClient, user: CurrentUser, fromSlug: string) {
  const versions = await prisma.scenarioVersion.findMany({ where: { scenario: { slug: fromSlug }, status: "PUBLISHED" }, orderBy: { version: "desc" }, take: 5, include: { scenario: true } });
  const source = versions.find((v) => v.definition !== null);
  if (!source) throw notFound("Scenario");
  const slug = `${fromSlug.slice(0, 40)}-${randomBytes(3).toString("hex")}`;
  const definition = { ...(source.definition as Record<string, unknown>), slug, version: 1, title: `${source.scenario.title} (draft)` };
  const scenario = await prisma.scenario.create({
    data: { slug, title: String(definition.title), summary: source.scenario.summary, authorId: user.id, versions: { create: { version: 0, status: "DRAFT", definition } } },
    include: { versions: true },
  });
  await prisma.auditLog.create({ data: { userId: user.id, action: "creator.fork", targetType: "Scenario", targetId: scenario.id, metadata: { from: fromSlug } } });
  return { slug, draftId: scenario.versions[0].id };
}

export async function getDraft(prisma: PrismaClient, user: CurrentUser, versionId: string) {
  const draft = await ownDraft(prisma, user, versionId);
  return { id: draft.id, slug: draft.scenario.slug, title: draft.scenario.title, definition: draft.definition, updatedAt: draft.scenario.updatedAt.toISOString(), validation: validateDefinition(draft.definition), catalog: { tools: [...TOOL_NAMES], effects: [...EFFECT_TYPES] } };
}

/** Saves a draft as is (it may be invalid while you work on it) and reports what's wrong. */
export async function saveDraft(prisma: PrismaClient, user: CurrentUser, versionId: string, definition: unknown) {
  const draft = await ownDraft(prisma, user, versionId);
  if (!definition || typeof definition !== "object" || Array.isArray(definition)) throw new GameError(422, "invalid_input", "The definition must be a JSON object");
  if (JSON.stringify(definition).length > MAX_DEFINITION_BYTES) throw new GameError(422, "too_large", "That scenario is too large");
  // The slug is the scenario's identity and stays fixed
  const fixed: Record<string, unknown> = { ...(definition as Record<string, unknown>), slug: draft.scenario.slug };
  await prisma.scenarioVersion.update({ where: { id: draft.id }, data: { definition: fixed as object } });
  const title = typeof fixed.title === "string" ? fixed.title.slice(0, 200) : draft.scenario.title;
  await prisma.scenario.update({ where: { id: draft.scenarioId }, data: { title, updatedAt: new Date() } });
  return validateDefinition(fixed);
}

async function materialize(prisma: PrismaClient, user: CurrentUser, versionId: string, status: "PREVIEW" | "PUBLISHED") {
  const draft = await ownDraft(prisma, user, versionId);
  const validation = validateDefinition(draft.definition);
  if (!validation.ok) throw rejected("invalid_scenario", `Fix ${validation.issues.length} problem(s) first: ${validation.issues[0]?.path}: ${validation.issues[0]?.message}`);
  const last = await prisma.scenarioVersion.aggregate({ where: { scenarioId: draft.scenarioId }, _max: { version: true } });
  const version = (last._max.version ?? 0) + 1;
  const input = { ...(draft.definition as z.input<typeof scenarioSchema>), version };
  const id = await prisma.$transaction((tx) => materializeVersion(tx, { scenarioId: draft.scenarioId, version, input, status }), { timeout: 30_000 });
  await prisma.auditLog.create({ data: { userId: user.id, action: status === "PUBLISHED" ? "creator.publish" : "creator.preview", targetType: "ScenarioVersion", targetId: id } });
  return { id, version };
}

/** An isolated test run: its own PREVIEW version and a save game that isn't listed with your investigations. */
export async function previewDraft(prisma: PrismaClient, user: CurrentUser, versionId: string) {
  const { id } = await materialize(prisma, user, versionId, "PREVIEW");
  const session = await createGameSession(prisma, user.id, { scenarioVersionId: id, isPreview: true });
  return { sessionId: session.id };
}

export async function publishDraft(prisma: PrismaClient, user: CurrentUser, versionId: string) {
  return materialize(prisma, user, versionId, "PUBLISHED");
}
