import { Annotation, END, GraphRecursionError, START, StateGraph } from "@langchain/langgraph";
import { z } from "zod";
import { estimateCostUsd, type Usage } from "../ai/chat-model";
import type { AiConfig } from "../ai/config";
import type { Embedder } from "../ai/embeddings";
import { playerMessageFor, ProviderError } from "../ai/errors";
import { GameError, notFound, rejected } from "../errors";
import { applyEffects, type AppliedOutcome } from "../engine/apply";
import { loadSessionContext, npcsReachableFrom, type SessionContext } from "../engine/context";
import { idempotencyKeySchema } from "../engine";
import { evaluateQuests } from "../engine/quests";
import type { PrismaClient } from "../prisma-client";
import type { ExecutedSummary, Interpretation, NpcBrain, NpcContext } from "./brain";
import { consolidateMemories, retrieveMemories, type RetrievedMemory } from "./memory";
import { buildNpcContext } from "./npc-context";
import { storyHooks } from "./story-hooks";
import { checkToolCalls, type ToolCall, type ToolDecision } from "./tools";
import { TraceRecorder, type TurnEvent } from "./trace";

/**
 * One NPC turn as a LangGraph state graph:
 *
 *   validate_request → load_state → build_npc_context → retrieve_memories → interpret
 *     ├─(needs action)──────────────→ plan → policy_check ─┐
 *     ├─(only story rules)─────────────────→ policy_check ─┤
 *     └─(small talk)──────────────────────────────────────→ execute → respond → consolidate_memory → finalize
 *
 * Model calls happen outside any database transaction; `execute` is the only node that changes game
 * state, in one short transaction with a row lock, after re-checking every approved call against the
 * state at that moment. Bounded: recursion limit, per-call and per-turn timeouts, a token budget,
 * a tool-call limit, and cancellation through an AbortSignal.
 */

export type TurnDeps = { prisma: PrismaClient; brain: NpcBrain; embedder: Embedder; config: AiConfig };
export type TurnInput = { userId: string; sessionId: string; npcKey: string; message: string; idempotencyKey: string };
export type TurnResult = {
  runId: string;
  replayed: boolean;
  reply: string;
  messageId: string | null;
  turn: number;
  outcomes: { type: string; status: "applied" | "skipped"; text: string }[];
};

const inputSchema = z.object({
  npcKey: z.string().min(1).max(64).regex(/^[a-z0-9][a-z0-9-]*$/),
  message: z.string().trim().min(1, "Say something").max(500, "Keep it under 500 characters"),
  idempotencyKey: idempotencyKeySchema,
});

const TurnState = Annotation.Root({
  input: Annotation<TurnInput>(),
  runId: Annotation<string>(),
  conversationId: Annotation<string>(),
  ctx: Annotation<SessionContext>(),
  npcContext: Annotation<NpcContext>(),
  memories: Annotation<RetrievedMemory[]>(),
  interpretation: Annotation<Interpretation>(),
  calls: Annotation<ToolCall[]>(),
  decisions: Annotation<ToolDecision[]>(),
  executed: Annotation<ExecutedSummary>(),
  outcomes: Annotation<AppliedOutcome[]>(),
  turn: Annotation<number>(),
  reply: Annotation<string>(),
  messageId: Annotation<string | null>(),
});
type State = typeof TurnState.State;

class Meter {
  usage: Usage = { inputTokens: 0, outputTokens: 0 };
  modelCalls = 0;
  retries = 0;
  add(r: { usage?: Usage; retries?: number; attempts?: number }) {
    if (r.usage) {
      this.usage.inputTokens += r.usage.inputTokens;
      this.usage.outputTokens += r.usage.outputTokens;
    }
    if (r.attempts !== undefined) this.modelCalls++;
    this.retries += r.retries ?? 0;
  }
  get total() {
    return this.usage.inputTokens + this.usage.outputTokens;
  }
}

const summarize = (o: AppliedOutcome) => (o.status === "applied" ? { type: o.effect.type, status: "applied" as const, text: o.text ?? o.effect.type } : { type: o.effect.type, status: "skipped" as const, text: o.reason });

/** Runs one player → NPC turn. Throws GameError for requests that never start a run. */
export async function runNpcTurn(deps: TurnDeps, input: TurnInput, options: { signal?: AbortSignal; onEvent?: (e: TurnEvent) => void } = {}): Promise<TurnResult> {
  const { prisma, brain, embedder, config } = deps;
  const emit = options.onEvent ?? (() => undefined);
  const parsed = inputSchema.safeParse(input);
  if (!parsed.success) throw new GameError(422, "invalid_input", parsed.error.issues[0]?.message ?? "Invalid input");
  const message = parsed.data.message;

  // ── validate_request (before a run exists): ownership, reachability, replay ──────────────────
  const session = await prisma.gameSession.findFirst({ where: { id: input.sessionId, userId: input.userId }, select: { id: true, status: true } });
  if (!session) throw notFound("Game session");
  if (session.status !== "ACTIVE") throw rejected("session_closed", "This investigation is closed");

  const previous = await prisma.agentRun.findUnique({
    where: { gameSessionId_idempotencyKey: { gameSessionId: session.id, idempotencyKey: input.idempotencyKey } },
    include: { messages: { where: { role: "NPC" } } },
  });
  if (previous) return replay(prisma, previous, emit);

  const ctx0 = await loadSessionContext(prisma, session.id, input.userId);
  const npc = ctx0.content.npcs.get(input.npcKey);
  if (!npc) throw rejected("unknown_npc", "Nobody by that name here");
  if (!npcsReachableFrom(ctx0.content, ctx0.state.currentLocationKey).some((n) => n.key === npc.key)) {
    throw rejected("npc_not_here", `${npc.name} isn't here. They're at ${npc.location.name}.`);
  }

  let runId: string;
  let conversationId: string;
  try {
    ({ runId, conversationId } = await prisma.$transaction(async (tx) => {
      const conversation = await tx.conversation.upsert({
        where: { gameSessionId_npcId: { gameSessionId: session.id, npcId: npc.id } },
        create: { gameSessionId: session.id, npcId: npc.id },
        update: {},
      });
      const run = await tx.agentRun.create({
        data: { gameSessionId: session.id, userId: input.userId, npcId: npc.id, provider: brain.provider, model: brain.model, isSimulated: brain.isSimulated, idempotencyKey: input.idempotencyKey },
      });
      await tx.message.create({ data: { conversationId: conversation.id, role: "PLAYER", content: message, agentRunId: run.id } });
      return { runId: run.id, conversationId: conversation.id };
    }));
  } catch (error) {
    // The same key arrived twice at the same moment: the other request owns the run
    if ((error as { code?: string })?.code === "P2002") throw rejected("turn_in_progress", "This message is already being answered");
    throw error;
  }

  emit({ type: "run_started", runId, npcKey: npc.key, provider: brain.provider, model: brain.model, simulated: brain.isSimulated });
  const signal = AbortSignal.any([AbortSignal.timeout(config.AI_TURN_TIMEOUT_MS), ...(options.signal ? [options.signal] : [])]);
  const trace = new TraceRecorder(prisma, runId, emit);
  const meter = new Meter();
  const started = Date.now();
  const checkCancelled = () => {
    if (signal.aborted) throw new ProviderError(options.signal?.aborted ? "cancelled" : "timeout", options.signal?.aborted ? "The turn was cancelled" : "The turn took too long", false);
  };

  await trace.step("validate_request", async () => ({
    value: null,
    summary: `Message accepted (${message.length} characters); ${npc.name} is reachable; new idempotency key.`,
  }));

  const graph = new StateGraph(TurnState)
    .addNode("load_state", async (s: State) =>
      trace.step("load_state", async () => {
        checkCancelled();
        const ctx = await loadSessionContext(prisma, s.input.sessionId, s.input.userId);
        const rel = ctx.state.relationships.get(npc.key)!;
        return { value: { ctx }, summary: `Turn ${ctx.state.turn}: trust ${rel.trust}, suspicion ${rel.suspicion}, alert ${ctx.state.alert}, ${ctx.state.questStatus.size} quests started.` };
      }),
    )
    .addNode("build_npc_context", async (s: State) =>
      trace.step("build_npc_context", async () => {
        const npcContext = await buildNpcContext(prisma, s.ctx, npc.key, message, []);
        return {
          value: { npcContext },
          summary: `${npcContext.stateFacts.length} facts, ${npcContext.history.length} earlier messages, ${npcContext.revealedSecrets.length} secrets unlocked by trust, ${npcContext.allowedTools.length} permitted tools.`,
          data: { facts: npcContext.stateFacts, hints: npcContext.hints, allowedTools: npcContext.allowedTools, secretsUnlocked: npcContext.revealedSecrets.length },
        };
      }),
    )
    .addNode("retrieve_memories", async (s: State) =>
      trace.step("retrieve_memories", async () => {
        checkCancelled();
        const memories = await retrieveMemories(prisma, embedder, { userId: s.input.userId, npcKey: npc.key, gameSessionId: s.input.sessionId }, message, signal);
        emit({
          type: "memories",
          items: memories.map((m) => ({ content: m.content, score: m.score, similarity: m.similarity, thisInvestigation: m.thisInvestigation })),
          embeddingModel: embedder.model,
          simulatedEmbeddings: embedder.isSimulated,
        });
        const npcContext = { ...s.npcContext, memories, dialogue: { ...s.npcContext.dialogue, memories: memories.map((m) => m.content) } };
        return {
          value: { memories, npcContext },
          summary: `${memories.length} memories recalled with ${embedder.model}${embedder.isSimulated ? " (deterministic test embeddings)" : ""}.`,
          data: { embeddingModel: embedder.model, items: memories },
        };
      }),
    )
    .addNode("interpret", async (s: State) =>
      trace.step("interpret", async () => {
        checkCancelled();
        const r = await brain.interpret(s.npcContext, signal);
        meter.add(r);
        return {
          value: { interpretation: r.value },
          summary: r.value.summary,
          data: { intent: r.value.intent, topics: r.value.topics, needsAction: r.value.needsAction, notable: r.value.notable, latencyMs: r.latencyMs, usage: r.usage },
        };
      }),
    )
    .addNode("plan", async (s: State) =>
      trace.step("plan", async () => {
        checkCancelled();
        const required = storyHooks(s.ctx, npc.key).required;
        if (meter.total + 2_000 > config.AI_TURN_TOKEN_BUDGET) {
          return { value: { calls: required }, summary: `token budget (${meter.total} of ${config.AI_TURN_TOKEN_BUDGET} used); only story rules apply.`, skipped: true };
        }
        const r = await brain.plan(s.npcContext, s.interpretation, signal);
        meter.add(r);
        const fromModel = r.value.toolCalls;
        const merged = [...required.filter((h) => !fromModel.some((c) => c.tool === h.tool && JSON.stringify(c.args) === JSON.stringify(h.args))), ...fromModel];
        return {
          value: { calls: merged },
          summary: `${fromModel.length} actions proposed${required.length ? ` + ${required.length} from story rules` : ""}. ${r.value.rationale}`.slice(0, 300),
          data: { proposals: merged, latencyMs: r.latencyMs, usage: r.usage },
        };
      }),
    )
    .addNode("policy_check", async (s: State) =>
      trace.step("policy_check", async () => {
        const calls = s.calls ?? storyHooks(s.ctx, npc.key).required;
        const decisions = checkToolCalls(s.ctx, npc.key, calls, config.maxToolCalls);
        const lookedUp: ExecutedSummary["lookedUp"] = [];
        for (const d of decisions) {
          if (d.status === "rejected") {
            await prisma.toolExecution.create({ data: { runId, toolName: String(d.call.tool).slice(0, 40), arguments: (d.call.args ?? {}) as object, status: "REJECTED", rejectionReason: d.reason } });
            emit({ type: "tool", tool: String(d.call.tool), source: d.call.source, status: "rejected", args: d.call.args, reason: d.reason });
          } else if (d.read) {
            const result = await readTool(prisma, embedder, s, d.tool, d.args as Record<string, string>, signal);
            lookedUp.push({ tool: d.tool, result });
            await prisma.toolExecution.create({ data: { runId, toolName: d.tool, arguments: d.args as object, status: "EXECUTED", result: result as object } });
            emit({ type: "tool", tool: d.tool, source: d.call.source, status: "executed", args: d.args, result });
          } else {
            emit({ type: "tool", tool: d.tool, source: d.call.source, status: "proposed", args: d.args });
          }
        }
        const ok = decisions.filter((d) => d.status === "approved").length;
        return {
          value: { calls, decisions, executed: { applied: [], rejected: [], lookedUp } },
          summary: `${ok} of ${decisions.length} calls allowed for ${npc.name}.`,
          data: { decisions: decisions.map((d) => (d.status === "approved" ? { tool: d.tool, args: d.args, source: d.call.source, status: "approved" } : { tool: d.call.tool, source: d.call.source, status: "rejected", reason: d.reason })) },
        };
      }),
    )
    .addNode("execute", async (s: State) =>
      trace.step("execute", async () => {
        checkCancelled();
        const writes = (s.decisions ?? []).filter((d): d is Extract<ToolDecision, { status: "approved" }> => d.status === "approved" && !d.read);
        const { outcomes, turn, perCall } = await prisma.$transaction(
          async (tx) => {
            await tx.$queryRaw`SELECT 1 FROM "WorldState" WHERE "gameSessionId" = ${s.input.sessionId} FOR UPDATE`;
            // State may have moved since the model started thinking: decide again on fresh state
            const fresh = await loadSessionContext(tx, s.input.sessionId, s.input.userId);
            const recheck = checkToolCalls(fresh, npc.key, writes.map((w) => w.call), config.maxToolCalls);
            const perCall: { decision: ToolDecision; applied: AppliedOutcome[] }[] = [];
            const all: AppliedOutcome[] = [];
            for (const d of recheck) {
              if (d.status !== "approved") {
                perCall.push({ decision: d, applied: [] });
                continue;
              }
              const applied = await applyEffects(tx, fresh, d.effects, { kind: "npc", npcKey: npc.key });
              perCall.push({ decision: d, applied });
              all.push(...applied);
            }
            fresh.state.talkedTo.add(npc.key);
            all.push(...(await evaluateQuests(tx, fresh)));
            const turn = fresh.state.turn + 1;
            await tx.worldState.update({ where: { gameSessionId: s.input.sessionId }, data: { turn } });
            await tx.gameSession.update({ where: { id: s.input.sessionId }, data: { lastPlayedAt: new Date() } });
            await tx.nPCRelationship.update({ where: { gameSessionId_npcId: { gameSessionId: s.input.sessionId, npcId: npc.id } }, data: { lastInteractionAt: new Date() } });
            await tx.gameEvent.create({
              data: {
                gameSessionId: s.input.sessionId,
                type: "talk",
                actor: "PLAYER",
                idempotencyKey: s.input.idempotencyKey,
                turn,
                payload: { npcKey: npc.key, message },
                result: { type: "talk", turn, narration: [], outcomes: all.map(summarize), npcKey: npc.key, agentRunId: runId },
              },
            });
            return { outcomes: all, turn, perCall };
          },
          { maxWait: 5_000, timeout: 15_000 },
        );

        for (const { decision, applied } of perCall) {
          const first = applied[0];
          const executed = decision.status === "approved" && applied.some((a) => a.status === "applied");
          await prisma.toolExecution.create({
            data: {
              runId,
              toolName: decision.status === "approved" ? decision.tool : String(decision.call.tool).slice(0, 40),
              arguments: (decision.status === "approved" ? decision.args : decision.call.args ?? {}) as object,
              status: executed ? "EXECUTED" : "REJECTED",
              result: applied.map((o) => (o.status === "applied" ? { status: "applied", text: o.text ?? null } : { status: "skipped", reason: o.reason })),
              rejectionReason: decision.status === "rejected" ? `recheck: ${decision.reason}` : !executed && first?.status === "skipped" ? `engine: ${first.reason}` : null,
            },
          });
          emit({
            type: "tool",
            tool: decision.status === "approved" ? decision.tool : String(decision.call.tool),
            source: decision.call.source,
            status: executed ? "executed" : "rejected",
            ...(executed ? { result: applied.map(summarize) } : { reason: decision.status === "rejected" ? decision.reason : first?.status === "skipped" ? first.reason : "no effect" }),
          });
        }
        for (const o of outcomes) emit({ type: "outcome", text: summarize(o).text, status: o.status });

        const executed: ExecutedSummary = {
          applied: outcomes.filter((o) => o.status === "applied").map((o) => o.text ?? o.effect.type),
          rejected: [
            ...(s.decisions ?? []).filter((d) => d.status === "rejected").map((d) => `${String(d.call.tool)} (${(d as { reason: string }).reason})`),
            ...outcomes.filter((o) => o.status === "skipped").map((o) => `${o.effect.type} (${(o as { reason: string }).reason})`),
          ],
          lookedUp: s.executed?.lookedUp ?? [],
        };
        return {
          value: { outcomes, turn, executed },
          summary: `${executed.applied.length} state changes committed in turn ${turn}.`,
          data: { changes: outcomes.map(summarize) },
        };
      }),
    )
    .addNode("respond", async (s: State) =>
      trace.step("respond", async () => {
        checkCancelled();
        const r = await brain.respond(s.npcContext, s.executed, signal, (text) => emit({ type: "delta", text }));
        meter.add(r);
        const saved = await prisma.message.create({
          data: { conversationId, role: "NPC", content: r.value, provider: brain.provider, isSimulated: brain.isSimulated, agentRunId: runId },
        });
        return {
          value: { reply: r.value, messageId: saved.id },
          summary: brain.isSimulated ? "Reply from the deterministic mock script (simulated, not AI-generated)." : `Reply generated by ${brain.model} (${r.value.length} characters).`,
          data: { latencyMs: r.latencyMs, usage: r.usage, simulated: brain.isSimulated },
        };
      }),
    )
    .addNode("consolidate_memory", async (s: State) =>
      trace.step("consolidate_memory", async () => {
        const i = s.interpretation;
        const candidates = i.notable && i.memoryNote ? [{ content: i.memoryNote, kind: i.memoryKind, importance: i.importance, source: "interpretation" }] : [];
        const result = await consolidateMemories(prisma, embedder, { userId: s.input.userId, npcKey: npc.key, gameSessionId: s.input.sessionId, npcId: npc.id, runId }, candidates, signal);
        return {
          value: null,
          summary: `${result.stored.length} new memories, ${result.skipped.length} skipped, ${result.embedded} embedded.`,
          data: result,
        };
      }),
    )
    .addEdge(START, "load_state")
    .addEdge("load_state", "build_npc_context")
    .addEdge("build_npc_context", "retrieve_memories")
    .addEdge("retrieve_memories", "interpret")
    // Conditional routing: ordinary conversation skips planning and policy entirely
    .addConditionalEdges(
      "interpret",
      (s: State) => (s.interpretation.needsAction ? "plan" : storyHooks(s.ctx, npc.key).required.length ? "policy_check" : "execute"),
      ["plan", "policy_check", "execute"],
    )
    .addEdge("plan", "policy_check")
    .addEdge("policy_check", "execute")
    .addEdge("execute", "respond")
    .addEdge("respond", "consolidate_memory")
    .addEdge("consolidate_memory", END)
    .compile();

  try {
    const final = await graph.invoke({ input, runId, conversationId }, { recursionLimit: config.maxTransitions, signal });
    await trace.step("finalize", async () => ({ value: null, summary: `Run complete in ${Date.now() - started} ms, ${meter.modelCalls} model calls.` }));
    await finishRun(prisma, runId, "SUCCEEDED", started, meter, trace.transitions);
    emit({ type: "usage", inputTokens: meter.usage.inputTokens, outputTokens: meter.usage.outputTokens, modelCalls: meter.modelCalls, retries: meter.retries });
    emit({ type: "done", messageId: final.messageId, reply: final.reply, turn: final.turn, replayed: false });
    return { runId, replayed: false, reply: final.reply, messageId: final.messageId, turn: final.turn, outcomes: (final.outcomes ?? []).map(summarize) };
  } catch (error) {
    const providerError =
      error instanceof ProviderError
        ? error
        : error instanceof GraphRecursionError
          ? new ProviderError("provider_error", `Graph stopped after ${config.maxTransitions} transitions`, false)
          : signal.aborted
            ? new ProviderError(options.signal?.aborted ? "cancelled" : "timeout", "The turn was interrupted", false)
            : null;
    const status = providerError?.code === "cancelled" ? "CANCELLED" : "FAILED";
    const detail = providerError ? `${providerError.code}: ${providerError.message}` : error instanceof Error ? error.message : String(error);
    await finishRun(prisma, runId, status, started, meter, trace.transitions, detail.slice(0, 500));
    emit({ type: "error", code: providerError?.code ?? "internal", message: providerError ? playerMessageFor(providerError.code) : "Something went wrong on our side." });
    if (error instanceof GameError) throw error;
    throw new GameError(providerError?.code === "cancelled" ? 409 : 422, providerError ? `ai_${providerError.code}` : "turn_failed", providerError ? playerMessageFor(providerError.code) : "The NPC couldn't answer. Try again.");
  }
}

async function finishRun(prisma: PrismaClient, runId: string, status: "SUCCEEDED" | "FAILED" | "CANCELLED", started: number, meter: Meter, transitions: number, error?: string) {
  await prisma.agentRun.update({
    where: { id: runId },
    data: {
      status,
      finishedAt: new Date(),
      latencyMs: Date.now() - started,
      inputTokens: meter.usage.inputTokens,
      outputTokens: meter.usage.outputTokens,
      modelCalls: meter.modelCalls,
      retries: meter.retries,
      transitions,
      estimatedCostUsd: estimateCostUsd(),
      error: error ?? null,
    },
  });
}

async function replay(prisma: PrismaClient, run: { id: string; status: string; gameSessionId: string; idempotencyKey: string | null; messages: { id: string; content: string }[] }, emit: (e: TurnEvent) => void): Promise<TurnResult> {
  if (run.status === "RUNNING") throw rejected("turn_in_progress", "This message is already being answered");
  if (run.status !== "SUCCEEDED") throw rejected("turn_failed", "That message wasn't answered. Send it again.");
  const event = await prisma.gameEvent.findUnique({ where: { gameSessionId_idempotencyKey: { gameSessionId: run.gameSessionId, idempotencyKey: run.idempotencyKey! } } });
  const result = (event?.result ?? {}) as { turn?: number; outcomes?: TurnResult["outcomes"] };
  const reply = run.messages[0]?.content ?? "";
  emit({ type: "done", messageId: run.messages[0]?.id ?? null, reply, turn: result.turn ?? null, replayed: true });
  return { runId: run.id, replayed: true, reply, messageId: run.messages[0]?.id ?? null, turn: result.turn ?? 0, outcomes: result.outcomes ?? [] };
}

/** Read-only tools. They only see this player's own state and this NPC's own memories. */
async function readTool(prisma: PrismaClient, embedder: Embedder, s: State, tool: string, args: Record<string, string>, signal: AbortSignal): Promise<unknown> {
  const { ctx } = s;
  switch (tool) {
    case "get_inventory":
      return [...ctx.state.inventory.entries()].map(([key, quantity]) => ({ item: ctx.content.items.get(key)!.name, quantity }));
    case "inspect_evidence": {
      const e = ctx.content.evidence.get(args.evidenceKey);
      if (!e || !ctx.state.evidence.has(e.key)) return { known: false, note: "The player hasn't shown you this." };
      return { known: true, title: e.title, description: e.description, reliability: e.reliability };
    }
    case "search_known_memories": {
      const found = await retrieveMemories(prisma, embedder, { userId: s.input.userId, npcKey: s.input.npcKey, gameSessionId: s.input.sessionId }, args.query, signal);
      return found.map((m) => ({ memory: m.content, score: m.score }));
    }
    default:
      return null;
  }
}
