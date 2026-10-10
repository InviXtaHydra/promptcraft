import { z } from "zod";
import type { SessionContext } from "../engine/context";
import type { Effect } from "../engine/effects";
import { checkProposals } from "../engine/policy";
import { TOOL_NAMES, type ToolName } from "./tool-names";

/**
 * The tools an NPC agent can call. Read tools return information for the reply; write tools are
 * translated into engine effects, which then pass the NPC policy and `applyEffects` like every other
 * change. Nothing here touches the database directly, runs code, builds SQL or calls the network.
 */

const key = z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/);
const text = (max: number) => z.string().trim().min(1).max(max);

export const toolArgs = {
  get_inventory: z.object({}).strict(),
  inspect_evidence: z.object({ evidenceKey: key }).strict(),
  search_known_memories: z.object({ query: text(200) }).strict(),
  transfer_item: z.object({ itemKey: key, direction: z.enum(["to_player", "from_player"]) }).strict(),
  transfer_credits: z.object({ amount: z.number().int().min(-500).max(500).refine((n) => n !== 0, "amount can't be 0"), reason: text(120) }).strict(),
  unlock_location: z.object({ locationKey: key }).strict(),
  update_quest: z
    .object({ action: z.enum(["start", "complete_objective"]), questKey: key, objectiveKey: key.optional() })
    .strict()
    .refine((a) => a.action === "start" || a.objectiveKey, "complete_objective needs an objectiveKey"),
  change_trust: z
    .object({ trustDelta: z.number().int().min(-25).max(25).optional(), suspicionDelta: z.number().int().min(-25).max(25).optional() })
    .strict()
    .refine((a) => a.trustDelta || a.suspicionDelta, "change trustDelta or suspicionDelta"),
  change_reputation: z.object({ delta: z.number().int().min(-10).max(10).refine((n) => n !== 0) }).strict(),
  trigger_security_alert: z.object({ reason: text(160) }).strict(),
  record_world_event: z
    .object({ title: text(120), description: text(400), severity: z.enum(["INFO", "NOTICE", "WARNING", "CRITICAL"]).default("NOTICE"), key: key.optional() })
    .strict(),
} satisfies Record<ToolName, z.ZodType>;

export const TOOL_DESCRIPTIONS: Record<ToolName, string> = {
  get_inventory: "List the items the player carries. Args: {}",
  inspect_evidence: 'Look at a piece of evidence the player has shown you. Args: {"evidenceKey": string}',
  search_known_memories: 'Search what you remember about this player. Args: {"query": string}',
  transfer_item: 'Give an item to the player or take one. Args: {"itemKey": string, "direction": "to_player"|"from_player"}',
  transfer_credits: 'Pay the player (positive) or charge them (negative). Args: {"amount": integer, "reason": string}',
  unlock_location: 'Grant access to a location. Args: {"locationKey": string}',
  update_quest:
    'Start a quest you give, or complete an "ask about" objective addressed to you. Args: {"action": "start"|"complete_objective", "questKey": string, "objectiveKey"?: string}',
  change_trust: 'Adjust how much you trust or suspect the player (each between -25 and 25). Args: {"trustDelta"?: integer, "suspicionDelta"?: integer}',
  change_reputation: 'Adjust the player\'s standing with your faction (-10..10). Args: {"delta": integer}',
  trigger_security_alert: 'Raise the city security alert by one level. Args: {"reason": string}',
  record_world_event: 'Record something notable that happened in the city. Args: {"title": string, "description": string, "severity": "INFO"|"NOTICE"|"WARNING"|"CRITICAL"}',
};

export const READ_TOOLS: ReadonlySet<ToolName> = new Set(["get_inventory", "inspect_evidence", "search_known_memories"]);

export type ToolCall = { tool: string; args: unknown; /** "model", "script" (mock) or "story-rule" */ source: string };

const KEY_FIELDS = { questKey: "quests", evidenceKey: "evidence", itemKey: "items", locationKey: "locations" } as const;
const isKey = (v: unknown) => typeof v === "string" && /^[a-z0-9][a-z0-9-]*$/.test(v);
const loose = (v: string) => v.toLowerCase().replace(/^the\s+/, "").replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Small models sometimes name things by title ("The Ghost Courier") instead of key. Exact titles or
 * names from this scenario are mapped to their key; anything else is left alone and fails
 * validation. Objective keys are matched against the objective's key with "_" read as "-".
 * Returns the arguments to validate and which fields were normalised (shown in the trace).
 */
export function normalizeKeys(ctx: SessionContext, args: unknown): { args: unknown; normalized: string[] } {
  if (!args || typeof args !== "object" || Array.isArray(args)) return { args, normalized: [] };
  const out: Record<string, unknown> = { ...(args as Record<string, unknown>) };
  const normalized: string[] = [];
  const content = ctx.content as unknown as Record<string, Map<string, { key: string; title?: string; name?: string }> | undefined>;
  for (const [field, collection] of Object.entries(KEY_FIELDS)) {
    const value = out[field];
    if (typeof value !== "string" || isKey(value)) continue;
    const match = [...(content[collection]?.values() ?? [])].find((x) => loose(x.title ?? x.name ?? "") === loose(value));
    if (match) {
      out[field] = match.key;
      normalized.push(`${field}: "${value}" → ${match.key}`);
    }
  }
  if (typeof out.objectiveKey === "string" && !isKey(out.objectiveKey)) {
    const candidate = out.objectiveKey.toLowerCase().replace(/_/g, "-");
    if (isKey(candidate)) {
      normalized.push(`objectiveKey: "${out.objectiveKey}" → ${candidate}`);
      out.objectiveKey = candidate;
    }
  }
  return { args: out, normalized };
}

export type ToolDecision =
  | { call: ToolCall; status: "approved"; tool: ToolName; args: unknown; effects: Effect[]; read: boolean; normalized: string[] }
  | { call: ToolCall; status: "rejected"; reason: string };

/** Translates validated write-tool arguments into engine effects. The speaking NPC is always the subject. */
function effectsFor(tool: ToolName, args: never, ctx: SessionContext, npcKey: string): Effect[] {
  const npc = ctx.content.npcs.get(npcKey)!;
  switch (tool) {
    case "transfer_item": {
      const a = args as z.infer<typeof toolArgs.transfer_item>;
      return a.direction === "to_player"
        ? [{ type: "item_grant", itemKey: a.itemKey, quantity: 1, source: `given-by:${npcKey}` }]
        : [{ type: "item_remove", itemKey: a.itemKey, quantity: 1 }];
    }
    case "transfer_credits":
      return [{ type: "credits", delta: (args as z.infer<typeof toolArgs.transfer_credits>).amount }];
    case "unlock_location":
      return [{ type: "unlock_location", locationKey: (args as z.infer<typeof toolArgs.unlock_location>).locationKey }];
    case "update_quest": {
      const a = args as z.infer<typeof toolArgs.update_quest>;
      return a.action === "start" ? [{ type: "quest_start", questKey: a.questKey }] : [{ type: "objective", questKey: a.questKey, objectiveKey: a.objectiveKey! }];
    }
    case "change_trust": {
      const a = args as z.infer<typeof toolArgs.change_trust>;
      return [
        ...(a.trustDelta ? [{ type: "trust" as const, npcKey, delta: a.trustDelta }] : []),
        ...(a.suspicionDelta ? [{ type: "suspicion" as const, npcKey, delta: a.suspicionDelta }] : []),
      ];
    }
    case "change_reputation":
      return npc.faction ? [{ type: "faction", factionKey: npc.faction.key, delta: (args as z.infer<typeof toolArgs.change_reputation>).delta }] : [];
    case "trigger_security_alert":
      return [{ type: "alert", delta: 1 }];
    case "record_world_event": {
      const a = args as z.infer<typeof toolArgs.record_world_event>;
      return [{ type: "world_event", title: a.title, description: a.description, severity: a.severity, ...(a.key ? { key: a.key } : {}) }];
    }
    default:
      return [];
  }
}

const stable = (value: unknown): string =>
  value && typeof value === "object"
    ? Array.isArray(value)
      ? `[${value.map(stable).join(",")}]`
      : `{${Object.keys(value as object)
          .sort()
          .map((k) => `${k}:${stable((value as Record<string, unknown>)[k])}`)
          .join(",")}}`
    : JSON.stringify(value);

/**
 * Checks proposed tool calls in order: known tool, permitted for this NPC, valid arguments, not a
 * duplicate, within the per-turn limit, and the resulting effects allowed by the NPC policy.
 */
export function checkToolCalls(ctx: SessionContext, npcKey: string, calls: ToolCall[], maxToolCalls: number): ToolDecision[] {
  const npc = ctx.content.npcs.get(npcKey);
  const seen = new Set<string>();
  let counted = 0;
  // Limits across all calls of one turn, not just per call
  const totals = { alert: 0, trust: 0, suspicion: 0 };

  return calls.map((call): ToolDecision => {
    if (!npc) return { call, status: "rejected", reason: "unknown NPC" };
    if (!(TOOL_NAMES as readonly string[]).includes(call.tool)) return { call, status: "rejected", reason: `unknown tool "${String(call.tool).slice(0, 40)}"` };
    const tool = call.tool as ToolName;
    if (!npc.allowedTools.includes(tool)) return { call, status: "rejected", reason: `${npc.name} is not permitted to use ${tool}` };
    const { args: candidate, normalized } = normalizeKeys(ctx, call.args ?? {});
    const parsed = toolArgs[tool].safeParse(candidate);
    if (!parsed.success) return { call, status: "rejected", reason: `invalid arguments: ${parsed.error.issues[0]?.message ?? "invalid"}` };
    const signature = `${tool}:${stable(parsed.data)}`;
    if (seen.has(signature)) return { call, status: "rejected", reason: "duplicate of an earlier call in this turn" };
    seen.add(signature);
    if (++counted > maxToolCalls) return { call, status: "rejected", reason: `more than ${maxToolCalls} tool calls in one turn` };

    if (READ_TOOLS.has(tool)) return { call, status: "approved", tool, args: parsed.data, effects: [], read: true, normalized };
    const effects = effectsFor(tool, parsed.data as never, ctx, npc.key);
    if (effects.length === 0) return { call, status: "rejected", reason: "this tool has no effect for this NPC" };
    const verdicts = checkProposals(ctx, npc.key, effects);
    const refused = verdicts.find((v) => !v.ok);
    if (refused && !refused.ok) return { call, status: "rejected", reason: `policy: ${refused.reason}` };
    const approved = verdicts.map((v) => (v as { effect: Effect }).effect);
    for (const e of approved) {
      if (e.type === "alert" && totals.alert + e.delta > 1) return { call, status: "rejected", reason: "the alert can rise at most one level per turn" };
      if ((e.type === "trust" || e.type === "suspicion") && Math.abs(totals[e.type] + e.delta) > 25) {
        return { call, status: "rejected", reason: `${e.type} can change by at most 25 per turn` };
      }
    }
    for (const e of approved) {
      if (e.type === "alert") totals.alert += e.delta;
      if (e.type === "trust" || e.type === "suspicion") totals[e.type] += e.delta;
    }
    return { call, status: "approved", tool, args: parsed.data, effects: approved, read: false, normalized };
  });
}
