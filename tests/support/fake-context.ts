import { neonBabylon } from "../../src/content/neon-babylon";
import { scenarioSchema } from "../../src/content/scenario-schema";
import type { SessionContext } from "../../src/server/engine/context";

const scenario = scenarioSchema.parse(neonBabylon);

/** Enough of a session context for policy and tool checks, built from the real scenario content. */
export function fakeContext(overrides: { allowedTools?: Record<string, string[]> } = {}): SessionContext {
  const factions = new Map(scenario.factions.map((f) => [f.key, { ...f, id: `faction-${f.key}` }]));
  const npcs = new Map(
    scenario.npcs.map((n) => [
      n.key,
      {
        ...n,
        id: `npc-${n.key}`,
        factionId: n.factionKey ? `faction-${n.factionKey}` : null,
        faction: n.factionKey ? factions.get(n.factionKey) : null,
        allowedTools: overrides.allowedTools?.[n.key] ?? n.allowedTools,
      },
    ]),
  );
  const quests = new Map(scenario.quests.map((q) => [q.key, { ...q, giver: q.giverNpcKey ? { key: q.giverNpcKey } : null, objectives: q.objectives }]));
  const evidence = new Map(scenario.evidence.map((e) => [e.key, { ...e, sourceNpcId: e.sourceNpcKey ? `npc-${e.sourceNpcKey}` : null }]));
  return { sessionId: "s", userId: "u", content: { npcs, quests, evidence, factions }, state: {} } as unknown as SessionContext;
}
