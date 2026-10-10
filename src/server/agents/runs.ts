import { z } from "zod";
import type { RunDetail, RunSummary } from "@/lib/game-types";
import { notFound } from "../errors";
import type { PrismaClient } from "../prisma-client";

export const runFilterSchema = z.object({
  npcKey: z.string().regex(/^[a-z0-9-]+$/).max(64).optional(),
  status: z.enum(["RUNNING", "SUCCEEDED", "FAILED", "CANCELLED"]).optional(),
  limit: z.coerce.number().int().min(1).max(100).default(30),
});

/** The player's own runs in one save game. Another player's session is "not found". */
async function assertOwner(prisma: PrismaClient, sessionId: string, userId: string) {
  const session = await prisma.gameSession.findFirst({ where: { id: sessionId, userId }, select: { id: true } });
  if (!session) throw notFound("Game session");
}

export async function listRuns(prisma: PrismaClient, sessionId: string, userId: string, filter: z.input<typeof runFilterSchema> = {}): Promise<RunSummary[]> {
  await assertOwner(prisma, sessionId, userId);
  const f = runFilterSchema.parse(filter);
  const runs = await prisma.agentRun.findMany({
    where: { gameSessionId: sessionId, userId, ...(f.status ? { status: f.status } : {}), ...(f.npcKey ? { npc: { key: f.npcKey } } : {}) },
    orderBy: { startedAt: "desc" },
    take: f.limit,
    include: { npc: true, tools: { select: { status: true } }, messages: { where: { role: "PLAYER" }, select: { content: true }, take: 1 } },
  });
  return runs.map((r) => ({
    id: r.id,
    npc: r.npc ? { key: r.npc.key, name: r.npc.name } : null,
    provider: r.provider,
    model: r.model,
    simulated: r.isSimulated,
    status: r.status,
    startedAt: r.startedAt.toISOString(),
    latencyMs: r.latencyMs,
    inputTokens: r.inputTokens,
    outputTokens: r.outputTokens,
    modelCalls: r.modelCalls,
    retries: r.retries,
    transitions: r.transitions,
    tools: { total: r.tools.length, rejected: r.tools.filter((t) => t.status === "REJECTED").length },
    error: r.error,
    playerMessage: r.messages[0]?.content ?? null,
  }));
}

export async function getRun(prisma: PrismaClient, sessionId: string, userId: string, runId: string): Promise<RunDetail> {
  await assertOwner(prisma, sessionId, userId);
  const run = await prisma.agentRun.findFirst({
    where: { id: runId, gameSessionId: sessionId, userId },
    include: {
      npc: true,
      steps: { orderBy: { index: "asc" } },
      tools: { orderBy: { createdAt: "asc" } },
      messages: { orderBy: { createdAt: "asc" }, select: { role: true, content: true, isSimulated: true } },
    },
  });
  if (!run) throw notFound("Agent run");
  const [summary] = await listRuns(prisma, sessionId, userId, { limit: 100 }).then((all) => all.filter((r) => r.id === run.id));
  return {
    ...summary,
    estimatedCostUsd: run.estimatedCostUsd === null ? null : Number(run.estimatedCostUsd),
    steps: run.steps.map((s) => ({ index: s.index, node: s.node, status: s.status, summary: s.summary, durationMs: s.durationMs, data: s.data ?? null })),
    toolExecutions: run.tools.map((t) => ({ id: t.id, tool: t.toolName, status: t.status, arguments: t.arguments, result: t.result ?? null, rejectionReason: t.rejectionReason })),
    messages: run.messages.map((m) => ({ role: m.role, content: m.content, simulated: m.isSimulated })),
  };
}
