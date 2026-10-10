import { notFound } from "../errors";
import { loadSessionContext } from "../engine/context";
import type { PrismaClient } from "../prisma-client";
import { checkToolCalls, type ToolCall } from "./tools";

/**
 * Aggregates for the AgentDebugger. Everything is computed from stored traces. "Measured" values
 * come from timers and Ollama's own token counts; the cost is an estimate (0 for local models).
 */

const percentile = (values: number[], p: number) => {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)];
};
const avg = (values: number[]) => (values.length ? Number((values.reduce((s, v) => s + v, 0) / values.length).toFixed(3)) : null);

async function assertOwner(prisma: PrismaClient, sessionId: string, userId: string) {
  const session = await prisma.gameSession.findFirst({ where: { id: sessionId, userId }, select: { id: true } });
  if (!session) throw notFound("Game session");
}

export async function sessionMetrics(prisma: PrismaClient, sessionId: string, userId: string) {
  await assertOwner(prisma, sessionId, userId);
  const [runs, tools, recallSteps, nodeSteps, ticks] = await Promise.all([
    prisma.agentRun.findMany({ where: { gameSessionId: sessionId, userId }, select: { status: true, latencyMs: true, inputTokens: true, outputTokens: true, modelCalls: true, retries: true, estimatedCostUsd: true, isSimulated: true, provider: true, model: true } }),
    prisma.toolExecution.findMany({ where: { run: { gameSessionId: sessionId, userId } }, select: { toolName: true, status: true, rejectionReason: true } }),
    prisma.agentStep.findMany({ where: { node: "retrieve_memories", run: { gameSessionId: sessionId, userId } }, select: { summary: true, data: true } }),
    prisma.agentStep.groupBy({ by: ["node"], where: { run: { gameSessionId: sessionId, userId } }, _avg: { durationMs: true }, _count: { _all: true } }),
    prisma.simulationTick.findMany({ where: { gameSessionId: sessionId }, select: { actions: true, durationMs: true } }),
  ]);

  const succeeded = runs.filter((r) => r.status === "SUCCEEDED");
  const latencies = succeeded.map((r) => r.latencyMs ?? 0);
  const byTool = new Map<string, { executed: number; rejected: number }>();
  const reasons = new Map<string, number>();
  for (const t of tools) {
    const entry = byTool.get(t.toolName) ?? { executed: 0, rejected: 0 };
    if (t.status === "EXECUTED") entry.executed++;
    else entry.rejected++;
    byTool.set(t.toolName, entry);
    if (t.rejectionReason) {
      const reason = t.rejectionReason.replace(/"[^"]*"/g, "…").slice(0, 80);
      reasons.set(reason, (reasons.get(reason) ?? 0) + 1);
    }
  }

  const recalls = recallSteps.map((s) => ((s.data as { items?: { similarity: number; score: number }[] } | null)?.items ?? []) as { similarity: number; score: number }[]);
  const unavailable = recallSteps.filter((s) => s.summary.startsWith("Skipped")).length;
  const actions = ticks.flatMap((t) => (t.actions as { status: string; actor: string }[]).filter((a) => a.actor !== "engine"));

  return {
    runs: {
      total: runs.length,
      byStatus: Object.fromEntries(["SUCCEEDED", "FAILED", "CANCELLED", "RUNNING"].map((s) => [s, runs.filter((r) => r.status === s).length])),
      simulated: runs.filter((r) => r.isSimulated).length,
      providers: [...new Set(runs.map((r) => `${r.provider}/${r.model}`))],
    },
    latencyMs: { measured: true, p50: percentile(latencies, 50), p95: percentile(latencies, 95), max: latencies.length ? Math.max(...latencies) : null },
    tokens: {
      measured: true,
      input: runs.reduce((s, r) => s + (r.inputTokens ?? 0), 0),
      output: runs.reduce((s, r) => s + (r.outputTokens ?? 0), 0),
      modelCalls: runs.reduce((s, r) => s + r.modelCalls, 0),
      retries: runs.reduce((s, r) => s + r.retries, 0),
    },
    cost: { estimated: true, usd: Number(runs.reduce((s, r) => s + Number(r.estimatedCostUsd ?? 0), 0).toFixed(6)), note: "Local models: no per-token cost. Electricity isn't counted." },
    tools: {
      total: tools.length,
      byTool: [...byTool.entries()].map(([tool, c]) => ({ tool, ...c })).sort((a, b) => b.executed + b.rejected - (a.executed + a.rejected)),
      topRejections: [...reasons.entries()].map(([reason, count]) => ({ reason, count })).sort((a, b) => b.count - a.count).slice(0, 6),
    },
    retrieval: {
      turns: recallSteps.length,
      turnsWithMemories: recalls.filter((r) => r.length > 0).length,
      unavailable,
      avgRecalled: avg(recalls.map((r) => r.length)),
      avgTopSimilarity: avg(recalls.filter((r) => r.length).map((r) => Math.max(...r.map((m) => m.similarity)))),
      avgScore: avg(recalls.flat().map((m) => m.score)),
    },
    nodes: nodeSteps.map((n) => ({ node: n.node, count: n._count._all, avgMs: n._avg.durationMs === null ? null : Math.round(n._avg.durationMs) })).sort((a, b) => (b.avgMs ?? 0) - (a.avgMs ?? 0)),
    simulation: {
      ticks: ticks.length,
      executed: actions.filter((a) => a.status === "executed").length,
      rejected: actions.filter((a) => a.status === "rejected").length,
      skipped: actions.filter((a) => a.status === "skipped").length,
      avgTickMs: avg(ticks.map((t) => t.durationMs)),
    },
  };
}

/**
 * Safe replay: the tool calls a recorded run proposed, checked again against today's rules and
 * the current state. A dry run: nothing is executed or written.
 */
export async function replayPolicy(prisma: PrismaClient, sessionId: string, userId: string, runId: string) {
  await assertOwner(prisma, sessionId, userId);
  const run = await prisma.agentRun.findFirst({ where: { id: runId, gameSessionId: sessionId, userId }, include: { npc: true, steps: { where: { node: "policy_check" } }, tools: { orderBy: { createdAt: "asc" } } } });
  if (!run) throw notFound("Agent run");
  if (!run.npc) return { runId, dryRun: true, comparisons: [], note: "This run has no NPC turn to replay." };
  const decisions = ((run.steps[0]?.data as { decisions?: { tool: string; args?: unknown; source?: string; status: string; reason?: string }[] } | null)?.decisions ?? []);
  if (!decisions.length) return { runId, dryRun: true, comparisons: [], note: "This turn proposed no tool calls (small talk)." };
  const ctx = await loadSessionContext(prisma, sessionId, userId);
  const calls: ToolCall[] = decisions.map((d) => ({ tool: d.tool, args: d.args ?? {}, source: d.source ?? "model" }));
  const now = checkToolCalls(ctx, run.npc.key, calls, 6);
  const executedThen = new Set(run.tools.filter((t) => t.status === "EXECUTED").map((t) => t.toolName));
  return {
    runId,
    dryRun: true,
    note: "Checked against the current rules and game state. Nothing was executed.",
    comparisons: decisions.map((d, i) => ({
      tool: d.tool,
      args: d.args ?? {},
      then: { status: d.status === "approved" ? (executedThen.has(d.tool) ? "executed" : "approved") : "rejected", reason: d.reason ?? null },
      now: now[i].status === "approved" ? { status: "approved", reason: null } : { status: "rejected", reason: (now[i] as { reason: string }).reason },
    })),
  };
}
