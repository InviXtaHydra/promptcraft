import { describe, expect, it } from "vitest";
import { forkScenario, getDraft, listCreatorScenarios, previewDraft, publishDraft, saveDraft, validateDefinition, assertCreator } from "@/server/creator";
import { DEFAULT_SCENARIO, createGameSession, listGameSessions, listPlayableScenarios } from "@/server/engine/sessions";
import { buildGameView } from "@/server/engine/view";
import { GameError } from "@/server/errors";
import type { CurrentUser } from "@/server/auth";
import { makePlayer, testPrisma } from "../support/factories";

async function makeUser(role: "PLAYER" | "CREATOR" | "ADMIN"): Promise<CurrentUser> {
  const p = await makePlayer();
  await testPrisma.user.update({ where: { id: p.id }, data: { role } });
  return { id: p.id, email: p.email, role, callsign: p.profile!.callsign };
}

async function draftFor(user: CurrentUser) {
  const { draftId, slug } = await forkScenario(testPrisma, user, DEFAULT_SCENARIO);
  const draft = await getDraft(testPrisma, user, draftId);
  return { draftId, slug, definition: draft.definition as Record<string, unknown> & { npcs: { key: string; name: string }[] } };
}

describe("Creator Mode", () => {
  it("is for creators and admins only, and drafts belong to their author", async () => {
    const player = await makeUser("PLAYER");
    expect(() => assertCreator(player)).toThrow(GameError);
    expect(() => assertCreator({ ...player, role: "CREATOR" })).not.toThrow();
    expect(() => assertCreator({ ...player, role: "ADMIN" })).not.toThrow();

    const creator = await makeUser("CREATOR");
    const other = await makeUser("CREATOR");
    const { draftId } = await draftFor(creator);
    await expect(getDraft(testPrisma, other, draftId)).rejects.toMatchObject({ status: 404 });
    await expect(saveDraft(testPrisma, other, draftId, {})).rejects.toMatchObject({ status: 404 });
    await expect(publishDraft(testPrisma, other, draftId)).rejects.toMatchObject({ status: 404 });
    expect((await listCreatorScenarios(testPrisma, other)).mine).toHaveLength(0);
  });

  it("forks the published scenario into a valid draft and reports validation problems with paths", async () => {
    const creator = await makeUser("CREATOR");
    const { draftId, slug, definition } = await draftFor(creator);
    expect(slug).toMatch(new RegExp(`^${DEFAULT_SCENARIO}-[0-9a-f]{6}$`));
    expect(validateDefinition(definition)).toEqual({ ok: true, issues: [] });

    // A schema problem: trust must be a number
    const broken = { ...definition, npcs: definition.npcs.map((n, i) => (i === 0 ? { ...n, baseTrust: "lots" } : n)) };
    const schema = await saveDraft(testPrisma, creator, draftId, broken);
    expect(schema.ok).toBe(false);
    expect(schema.issues[0].path).toBe("npcs.0.baseTrust");
    // Out of the engine's bounds (trust −100…100) is caught here, not by a database constraint later
    const tooTrusting = await saveDraft(testPrisma, creator, draftId, { ...definition, npcs: definition.npcs.map((n, i) => (i === 0 ? { ...n, baseTrust: 500 } : n)) });
    expect(tooTrusting.issues).toEqual([expect.objectContaining({ path: "npcs.0.baseTrust" })]);

    // A reference problem: an NPC in a place that doesn't exist
    const dangling = { ...definition, npcs: definition.npcs.map((n, i) => (i === 0 ? { ...n, locationKey: "atlantis" } : n)) };
    const refs = await saveDraft(testPrisma, creator, draftId, dangling);
    expect(refs.ok).toBe(false);
    expect(refs.issues.map((i) => i.message).join("\n")).toMatch(/atlantis/);

    // Invalid drafts are saved, but can't be previewed or published
    await expect(previewDraft(testPrisma, creator, draftId)).rejects.toMatchObject({ code: "invalid_scenario" });
    await expect(publishDraft(testPrisma, creator, draftId)).rejects.toMatchObject({ code: "invalid_scenario" });
    await expect(saveDraft(testPrisma, creator, draftId, ["not", "an", "object"])).rejects.toMatchObject({ status: 422 });
    await expect(saveDraft(testPrisma, creator, draftId, { ...definition, padding: "x".repeat(500_000) })).rejects.toMatchObject({ code: "too_large" });

    // The slug is the scenario's identity: edits can't change it
    await saveDraft(testPrisma, creator, draftId, { ...definition, slug: "hijacked" });
    expect((await getDraft(testPrisma, creator, draftId)).slug).toBe(slug);
  });

  it("runs a preview in isolation: its own version, a save game hidden from the player's list", async () => {
    const creator = await makeUser("CREATOR");
    const { draftId, slug, definition } = await draftFor(creator);
    await saveDraft(testPrisma, creator, draftId, { ...definition, title: "Rainy test", startingCredits: 999 });

    const { sessionId } = await previewDraft(testPrisma, creator, draftId);
    const view = await buildGameView(testPrisma, sessionId, creator.id, creator.callsign);
    expect(view.session).toMatchObject({ isPreview: true, scenarioTitle: "Rainy test" });
    expect(view.world.credits).toBe(999);

    expect(await listGameSessions(testPrisma, creator.id)).toEqual([]);
    expect((await listPlayableScenarios(testPrisma)).map((s) => s.slug)).not.toContain(slug);
    // A player can't start a preview version as a normal game
    const preview = await testPrisma.gameSession.findUniqueOrThrow({ where: { id: sessionId } });
    const player = await makeUser("PLAYER");
    await expect(createGameSession(testPrisma, player.id, { scenarioVersionId: preview.scenarioVersionId })).rejects.toMatchObject({ code: "no_scenario" });
    // ...and nobody else can open the preview save game
    await expect(buildGameView(testPrisma, sessionId, player.id, player.callsign)).rejects.toBeInstanceOf(GameError);

    // The published original is untouched
    const original = await createGameSession(testPrisma, player.id);
    expect((await buildGameView(testPrisma, original.id, player.id, player.callsign)).world.credits).not.toBe(999);
  });

  it("publishes immutable versions that players can start, while running games keep theirs", async () => {
    const creator = await makeUser("CREATOR");
    const { draftId, slug, definition } = await draftFor(creator);
    await saveDraft(testPrisma, creator, draftId, { ...definition, startingCredits: 111 });
    const first = await publishDraft(testPrisma, creator, draftId);
    expect(first.version).toBe(1);
    expect((await listPlayableScenarios(testPrisma)).map((s) => s.slug)).toContain(slug);

    const player = await makeUser("PLAYER");
    const game = await createGameSession(testPrisma, player.id, { scenarioSlug: slug });
    expect(game.scenarioVersionId).toBe(first.id);

    await saveDraft(testPrisma, creator, draftId, { ...definition, startingCredits: 222 });
    const second = await publishDraft(testPrisma, creator, draftId);
    expect(second.version).toBe(2);

    // The running game still plays version 1; new games get version 2
    expect((await buildGameView(testPrisma, game.id, player.id, player.callsign)).world.credits).toBe(111);
    const newer = await createGameSession(testPrisma, player.id, { scenarioSlug: slug });
    expect(newer.scenarioVersionId).toBe(second.id);
    const v1 = await testPrisma.scenarioVersion.findUniqueOrThrow({ where: { id: first.id } });
    expect((v1.definition as { startingCredits: number }).startingCredits).toBe(111);

    const audit = await testPrisma.auditLog.findMany({ where: { userId: creator.id }, select: { action: true } });
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(["creator.fork", "creator.publish"]));
  });
});
