import type { Prisma } from "@/generated/prisma/client";
import type { PrismaClient } from "../prisma-client";

/** Events streamed to the browser (chat + AgentDebugger) while a turn runs. */
export type TurnEvent =
  | { type: "run_started"; runId: string; npcKey: string; provider: string; model: string; simulated: boolean }
  | { type: "node"; node: string; status: "started" | "succeeded" | "failed" | "skipped"; summary?: string; durationMs?: number; data?: unknown }
  | { type: "memories"; items: { content: string; score: number; similarity: number; thisInvestigation: boolean }[]; embeddingModel: string; simulatedEmbeddings: boolean }
  | { type: "tool"; tool: string; source: string; status: "proposed" | "rejected" | "executed"; args?: unknown; reason?: string; result?: unknown }
  | { type: "outcome"; text: string; status: "applied" | "skipped" }
  | { type: "delta"; text: string }
  | { type: "usage"; inputTokens: number; outputTokens: number; modelCalls: number; retries: number }
  | { type: "done"; messageId: string | null; reply: string | null; turn: number | null; replayed: boolean }
  | { type: "error"; code: string; message: string };

/**
 * Writes one AgentStep per graph node as it finishes, so a failed or cancelled run still has the
 * steps up to the failure. Steps hold short summaries and structured data, never hidden reasoning.
 */
export class TraceRecorder {
  private index = 0;
  transitions = 0;

  constructor(
    private readonly prisma: PrismaClient,
    readonly runId: string,
    private readonly emit: (event: TurnEvent) => void,
  ) {}

  async step<T>(node: string, run: () => Promise<{ value: T; summary: string; data?: unknown; skipped?: boolean }>): Promise<T> {
    this.transitions++;
    const started = Date.now();
    this.emit({ type: "node", node, status: "started" });
    try {
      const { value, summary, data, skipped } = await run();
      const durationMs = Date.now() - started;
      await this.prisma.agentStep.create({
        data: { runId: this.runId, index: this.index++, node, status: "SUCCEEDED", summary: skipped ? `Skipped: ${summary}` : summary, data: (data ?? undefined) as Prisma.InputJsonValue | undefined, durationMs },
      });
      this.emit({ type: "node", node, status: skipped ? "skipped" : "succeeded", summary, durationMs, data });
      return value;
    } catch (error) {
      const durationMs = Date.now() - started;
      const message = error instanceof Error ? error.message.slice(0, 300) : "failed";
      const cancelled = (error as { code?: string })?.code === "cancelled";
      await this.prisma.agentStep.create({
        data: { runId: this.runId, index: this.index++, node, status: cancelled ? "CANCELLED" : "FAILED", summary: message, durationMs },
      });
      this.emit({ type: "node", node, status: "failed", summary: message, durationMs });
      throw error;
    }
  }
}
