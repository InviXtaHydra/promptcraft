"use client";

import { useCallback, useEffect, useState } from "react";
import { Activity, AlertTriangle, CheckCircle2, ChevronDown, CircleDashed, FlaskConical, RefreshCw, XCircle } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { api, ApiError } from "@/lib/api-client";
import type { RunDetail, RunSummary, TurnStreamEvent } from "@/lib/game-types";
import { cn } from "@/lib/utils";

/**
 * Observability for the NPC agents: the live turn as it streams, and every recorded run with its
 * graph steps, recalled memories, tool calls, policy decisions, state changes, tokens and latency.
 * Only structured traces and one-line decision summaries; never hidden reasoning.
 */

const NODE_LABEL: Record<string, string> = {
  validate_request: "Validate request",
  load_state: "Load game state",
  build_npc_context: "Build NPC context",
  retrieve_memories: "Recall memories",
  interpret: "Interpret message",
  plan: "Plan actions",
  policy_check: "Policy check",
  execute: "Engine executes",
  respond: "Generate reply",
  consolidate_memory: "Consolidate memory",
  finalize: "Finalize trace",
};

const ms = (n: number | null | undefined) => (n === null || n === undefined ? "–" : n >= 1000 ? `${(n / 1000).toFixed(1)} s` : `${n} ms`);
const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { timeStyle: "medium" }).format(new Date(iso));

function StatusIcon({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === "succeeded" || s === "executed") return <CheckCircle2 className="size-4 text-cyan" aria-label={status} />;
  if (s === "failed" || s === "rejected") return <XCircle className="size-4 text-danger" aria-label={status} />;
  if (s === "cancelled" || s === "skipped") return <CircleDashed className="size-4 text-dim" aria-label={status} />;
  return <Activity className="size-4 animate-pulse text-amber" aria-label={status} />;
}

function Json({ value }: { value: unknown }) {
  return <pre className="mt-2 max-h-64 overflow-auto rounded border border-line bg-ink p-2 font-mono text-[0.7rem] leading-relaxed text-text/80">{JSON.stringify(value, null, 2)}</pre>;
}

function Expandable({ title, children, defaultOpen = false }: { title: React.ReactNode; children: React.ReactNode; defaultOpen?: boolean }) {
  return (
    <details className="group rounded-md border border-line bg-panel-2/60" open={defaultOpen}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3 py-2 text-sm">
        <ChevronDown className="size-4 shrink-0 text-dim transition-transform group-open:rotate-180" aria-hidden="true" />
        {title}
      </summary>
      <div className="border-t border-line px-3 pb-3">{children}</div>
    </details>
  );
}

function LiveTurn({ events }: { events: TurnStreamEvent[] }) {
  if (events.length === 0) return <p className="py-10 text-center text-sm text-dim">Talk to someone and their turn appears here as it happens.</p>;
  const start = events.find((e) => e.type === "run_started") as Extract<TurnStreamEvent, { type: "run_started" }> | undefined;
  const nodes = new Map<string, Extract<TurnStreamEvent, { type: "node" }>>();
  for (const e of events) if (e.type === "node") nodes.set(e.node, e);
  const memories = events.find((e) => e.type === "memories") as Extract<TurnStreamEvent, { type: "memories" }> | undefined;
  const tools = events.filter((e) => e.type === "tool") as Extract<TurnStreamEvent, { type: "tool" }>[];
  const usage = events.find((e) => e.type === "usage") as Extract<TurnStreamEvent, { type: "usage" }> | undefined;
  const error = events.find((e) => e.type === "error") as Extract<TurnStreamEvent, { type: "error" }> | undefined;
  const outcomes = events.filter((e) => e.type === "outcome") as Extract<TurnStreamEvent, { type: "outcome" }>[];

  return (
    <div className="space-y-4">
      {start && (
        <p className="font-mono text-xs text-dim">
          run {start.runId.slice(-10)} · {start.npcKey} · {start.provider}/{start.model}
          {start.simulated && <span className="ml-2 text-amber">simulated</span>}
        </p>
      )}
      {error && (
        <p role="alert" className="flex gap-2 rounded border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          <AlertTriangle className="size-4 shrink-0" aria-hidden="true" /> {error.code}: {error.message}
        </p>
      )}
      <ol className="space-y-1.5" aria-label="Graph nodes">
        {[...nodes.values()].map((n) => (
          <li key={n.node} className="flex items-start gap-2 text-sm">
            <StatusIcon status={n.status} />
            <span className="w-36 shrink-0">{NODE_LABEL[n.node] ?? n.node}</span>
            <span className="min-w-0 flex-1 text-xs text-dim">{n.summary}</span>
            <span className="shrink-0 font-mono text-xs text-dim">{ms(n.durationMs)}</span>
          </li>
        ))}
      </ol>
      {memories && (
        <Expandable title={<span>Memories recalled · {memories.items.length} · {memories.embeddingModel}{memories.simulatedEmbeddings ? " (test embeddings)" : ""}</span>}>
          <MemoryTable items={memories.items} />
        </Expandable>
      )}
      {tools.length > 0 && (
        <Expandable title={<span>Tool calls · {tools.length}</span>} defaultOpen>
          <ul className="mt-2 space-y-2">
            {tools.map((t, i) => (
              <li key={i} className="text-xs">
                <p className="flex items-center gap-2">
                  <StatusIcon status={t.status} /> <span className="font-mono">{t.tool}</span> <span className="text-dim">({t.source})</span> <span className="ml-auto text-dim">{t.status}</span>
                </p>
                {t.reason && <p className="ml-6 text-danger/90">{t.reason}</p>}
              </li>
            ))}
          </ul>
        </Expandable>
      )}
      {outcomes.length > 0 && (
        <Expandable title={<span>State changes · {outcomes.filter((o) => o.status === "applied").length}</span>}>
          <ul className="mt-2 space-y-1 text-xs">
            {outcomes.map((o, i) => (
              <li key={i} className={o.status === "applied" ? "" : "text-dim"}>
                {o.status === "applied" ? "✓" : "–"} {o.text}
              </li>
            ))}
          </ul>
        </Expandable>
      )}
      {usage && (
        <p className="font-mono text-xs text-dim">
          tokens {usage.inputTokens} in / {usage.outputTokens} out · {usage.modelCalls} model calls · {usage.retries} retries
        </p>
      )}
    </div>
  );
}

function MemoryTable({ items }: { items: { content: string; score: number; similarity: number; thisInvestigation: boolean }[] }) {
  if (items.length === 0) return <p className="mt-2 text-xs text-dim">Nothing recalled: this NPC has no relevant memories of the player yet.</p>;
  return (
    <table className="mt-2 w-full text-left text-xs">
      <thead className="text-dim">
        <tr>
          <th className="py-1 font-normal">Memory</th>
          <th className="py-1 text-right font-normal">Similarity</th>
          <th className="py-1 text-right font-normal">Score</th>
        </tr>
      </thead>
      <tbody>
        {items.map((m, i) => (
          <tr key={i} className="border-t border-line align-top">
            <td className="py-1.5 pr-2">
              {m.content}
              {!m.thisInvestigation && <span className="ml-1 text-violet">(earlier investigation)</span>}
            </td>
            <td className="py-1.5 text-right font-mono">{m.similarity.toFixed(2)}</td>
            <td className="py-1.5 text-right font-mono">{m.score.toFixed(2)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RunDetailView({ run, sessionId }: { run: RunDetail; sessionId: string }) {
  const memoryStep = run.steps.find((s) => s.node === "retrieve_memories");
  const memories = ((memoryStep?.data as { items?: { content: string; score: number; similarity: number; thisInvestigation: boolean }[] } | null)?.items ?? []) as {
    content: string;
    score: number;
    similarity: number;
    thisInvestigation: boolean;
  }[];
  const changes = ((run.steps.find((s) => s.node === "execute")?.data as { changes?: { status: string; text: string }[] } | null)?.changes ?? []) as { status: string; text: string }[];
  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 rounded-md border border-line p-3 text-xs sm:grid-cols-3">
        {[
          ["Run", run.id.slice(-12)],
          ["Agent", run.npc?.name ?? "–"],
          ["Provider", `${run.provider}/${run.model}`],
          ["Status", run.status.toLowerCase()],
          ["Latency", ms(run.latencyMs)],
          ["Tokens", `${run.inputTokens ?? 0} in / ${run.outputTokens ?? 0} out`],
          ["Model calls", String(run.modelCalls)],
          ["Retries", String(run.retries)],
          ["Transitions", String(run.transitions)],
          ["Tool calls", `${run.tools.total} (${run.tools.rejected} rejected)`],
          ["Est. cost", run.estimatedCostUsd === null ? "–" : `$${run.estimatedCostUsd.toFixed(4)} (local, estimate)`],
          ["Output", run.simulated ? "simulated script" : "language model"],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-dim">{k}</dt>
            <dd className="font-mono break-words">{v}</dd>
          </div>
        ))}
      </dl>
      {run.error && (
        <p role="alert" className="rounded border border-danger/40 bg-danger/10 p-3 text-xs text-danger">
          {run.error}
        </p>
      )}
      <section aria-label="Graph steps">
        <h4 className="mb-2 font-display text-sm font-semibold">Graph</h4>
        <ol className="space-y-1.5">
          {run.steps.map((s) => (
            <li key={s.index}>
              <Expandable
                title={
                  <span className="flex min-w-0 flex-1 items-center gap-2">
                    <StatusIcon status={s.status} />
                    <span className="w-36 shrink-0">{NODE_LABEL[s.node] ?? s.node}</span>
                    <span className="min-w-0 flex-1 truncate text-xs text-dim">{s.summary}</span>
                    <span className="shrink-0 font-mono text-xs text-dim">{ms(s.durationMs)}</span>
                  </span>
                }
              >
                <p className="mt-2 text-xs">{s.summary}</p>
                {s.data !== null && <Json value={s.data} />}
              </Expandable>
            </li>
          ))}
        </ol>
      </section>
      <section aria-label="Recalled memories">
        <h4 className="font-display text-sm font-semibold">Memory retrieval</h4>
        <MemoryTable items={memories} />
      </section>
      <section aria-label="Tool executions">
        <h4 className="mb-2 font-display text-sm font-semibold">Tool calls and policy</h4>
        {run.toolExecutions.length === 0 && <p className="text-xs text-dim">No tools were proposed in this turn.</p>}
        <ul className="space-y-1.5">
          {run.toolExecutions.map((t) => (
            <li key={t.id}>
              <Expandable
                title={
                  <span className="flex flex-1 items-center gap-2">
                    <StatusIcon status={t.status} /> <span className="font-mono text-xs">{t.tool}</span>
                    <span className="ml-auto text-xs text-dim">{t.status.toLowerCase()}</span>
                  </span>
                }
              >
                {t.rejectionReason && <p className="mt-2 text-xs text-danger">{t.rejectionReason}</p>}
                <p className="mt-2 text-xs text-dim">Validated arguments</p>
                <Json value={t.arguments} />
                {t.result !== null && (
                  <>
                    <p className="mt-2 text-xs text-dim">Result</p>
                    <Json value={t.result} />
                  </>
                )}
              </Expandable>
            </li>
          ))}
        </ul>
      </section>
      <ReplayButton sessionId={sessionId} runId={run.id} />
      <section aria-label="State changes">
        <h4 className="font-display text-sm font-semibold">Database state changes</h4>
        {changes.length === 0 ? (
          <p className="mt-1 text-xs text-dim">Nothing changed.</p>
        ) : (
          <ul className="mt-1 space-y-1 text-xs">
            {changes.map((c, i) => (
              <li key={i} className={c.status === "applied" ? "" : "text-dim"}>
                {c.status === "applied" ? "✓" : "–"} {c.text}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function RunsHistory({ sessionId, refreshKey }: { sessionId: string; refreshKey: number }) {
  const [npcKey, setNpcKey] = useState("");
  const [status, setStatus] = useState("");
  const [runs, setRuns] = useState<RunSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RunDetail | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [comparison, setComparison] = useState<[RunDetail, RunDetail] | null>(null);
  const [reload, setReload] = useState(0);
  // NPCs that appear in this save game's runs, for the filter (kept when a filter narrows the list)
  const [known, setKnown] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    const controller = new AbortController();
    const q = new URLSearchParams({ limit: "40", ...(npcKey ? { npcKey } : {}), ...(status ? { status } : {}) });
    api<{ runs: RunSummary[] }>(`/api/sessions/${sessionId}/runs?${q}`, { signal: controller.signal })
      .then((r) => {
        setRuns(r.runs);
        setError(null);
        setKnown((prev) => {
          const next = new Map(prev);
          for (const run of r.runs) if (run.npc) next.set(run.npc.key, run.npc.name);
          return next.size === prev.size ? prev : next;
        });
      })
      .catch((e) => {
        if (!controller.signal.aborted) setError(e instanceof ApiError ? e.message : "Couldn't load the runs");
      });
    return () => controller.abort();
  }, [sessionId, npcKey, status, refreshKey, reload]);

  const open = useCallback(
    async (id: string) => {
      try {
        setSelected((await api<{ run: RunDetail }>(`/api/sessions/${sessionId}/runs/${id}`)).run);
      } catch (e) {
        setError(e instanceof ApiError ? e.message : "Couldn't load the run");
      }
    },
    [sessionId],
  );

  async function compare() {
    try {
      const [a, b] = await Promise.all(compareIds.map((id) => api<{ run: RunDetail }>(`/api/sessions/${sessionId}/runs/${id}`).then((r) => r.run)));
      setComparison([a, b]);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't load the runs");
    }
  }

  if (comparison) {
    return (
      <div>
        <button type="button" onClick={() => setComparison(null)} className="mb-3 text-sm text-cyan underline-offset-4 hover:underline">
          ← All runs
        </button>
        <CompareRuns a={comparison[0]} b={comparison[1]} />
      </div>
    );
  }

  if (selected) {
    return (
      <div>
        <button type="button" onClick={() => setSelected(null)} className="mb-3 text-sm text-cyan underline-offset-4 hover:underline">
          ← All runs
        </button>
        <RunDetailView run={selected} sessionId={sessionId} />
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <label className="text-xs text-dim">
          NPC{" "}
          <select value={npcKey} onChange={(e) => setNpcKey(e.target.value)} className="ml-1 rounded border border-line bg-ink px-2 py-1 text-text">
            <option value="">All</option>
            {[...known.entries()].map(([k, name]) => (
              <option key={k} value={k}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-dim">
          Status{" "}
          <select value={status} onChange={(e) => setStatus(e.target.value)} className="ml-1 rounded border border-line bg-ink px-2 py-1 text-text">
            <option value="">All</option>
            {["SUCCEEDED", "FAILED", "CANCELLED", "RUNNING"].map((s) => (
              <option key={s} value={s}>
                {s.toLowerCase()}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          disabled={compareIds.length !== 2}
          onClick={() => void compare()}
          className="rounded border border-line px-2 py-1 text-xs text-dim hover:text-text disabled:opacity-40"
          title="Tick two runs to compare them"
        >
          Compare ({compareIds.length}/2)
        </button>
        <button type="button" onClick={() => setReload((n) => n + 1)} className="ml-auto inline-flex items-center gap-1 text-xs text-dim hover:text-text">
          <RefreshCw className="size-3.5" aria-hidden="true" /> Refresh
        </button>
      </div>
      {error && (
        <p role="alert" className="rounded border border-danger/40 bg-danger/10 p-3 text-sm text-danger">
          {error}
        </p>
      )}
      {!error && runs === null && <div className="h-24 animate-pulse rounded-md border border-line bg-panel-2" />}
      {runs?.length === 0 && <p className="py-8 text-center text-sm text-dim">No runs match these filters yet.</p>}
      <ul className="space-y-1.5">
        {runs?.map((r) => (
          <li key={r.id} className="flex items-start gap-2">
            <input
              type="checkbox"
              aria-label={`Compare run ${r.id.slice(-6)}`}
              checked={compareIds.includes(r.id)}
              onChange={(e) => setCompareIds((ids) => (e.target.checked ? [...ids, r.id].slice(-2) : ids.filter((x) => x !== r.id)))}
              className="mt-3 accent-[var(--cyan)]"
            />
            <button type="button" onClick={() => void open(r.id)} className="w-full rounded-md border border-line p-2.5 text-left transition-colors hover:border-cyan/50">
              <span className="flex items-center gap-2 text-sm">
                <StatusIcon status={r.status} />
                <span className="font-medium">{r.npc?.name ?? "–"}</span>
                {r.simulated && <FlaskConical className="size-3.5 text-amber" aria-label="simulated" />}
                <span className="ml-auto font-mono text-xs text-dim">{when(r.startedAt)}</span>
              </span>
              <span className="mt-1 block truncate text-xs text-dim">{r.playerMessage ?? "(reaction to an item)"}</span>
              <span className="mt-1 block font-mono text-[0.7rem] text-dim">
                {ms(r.latencyMs)} · {(r.inputTokens ?? 0) + (r.outputTokens ?? 0)} tokens · {r.modelCalls} calls · {r.tools.total} tools ({r.tools.rejected} rejected)
              </span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AgentDebugger({
  open,
  onOpenChange,
  sessionId,
  liveEvents,
  refreshKey,
  onView,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  liveEvents: TurnStreamEvent[];
  refreshKey: number;
  onView: (view: unknown) => void;
}) {
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="right" className="w-full overflow-y-auto border-line bg-panel sm:max-w-xl">
        <SheetHeader>
          <SheetTitle className="font-display text-xl">Agent debugger</SheetTitle>
          <SheetDescription>What each NPC agent recalled, proposed, was refused and changed. Structured traces only.</SheetDescription>
        </SheetHeader>
        <Tabs defaultValue="live" className="px-4 pb-6">
          <TabsList>
            <TabsTrigger value="live">Live turn</TabsTrigger>
            <TabsTrigger value="runs">All runs</TabsTrigger>
            <TabsTrigger value="metrics">Metrics</TabsTrigger>
            <TabsTrigger value="simulation">Simulation</TabsTrigger>
          </TabsList>
          <TabsContent value="live" className={cn("pt-3")}>
            <LiveTurn events={liveEvents} />
          </TabsContent>
          <TabsContent value="runs" className="pt-3">
            <RunsHistory sessionId={sessionId} refreshKey={refreshKey} />
          </TabsContent>
          <TabsContent value="metrics" className="pt-3">
            <MetricsPanel sessionId={sessionId} refreshKey={refreshKey} />
          </TabsContent>
          <TabsContent value="simulation" className="pt-3">
            <SimulationPanel sessionId={sessionId} refreshKey={refreshKey} onView={onView} />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}

// ─── Phase 3: metrics, comparison, replay, simulation ───────────────────────────────────────────

type Metrics = {
  runs: { total: number; byStatus: Record<string, number>; simulated: number; providers: string[] };
  latencyMs: { measured: boolean; p50: number | null; p95: number | null; max: number | null };
  tokens: { measured: boolean; input: number; output: number; modelCalls: number; retries: number };
  cost: { estimated: boolean; usd: number; note: string };
  tools: { total: number; byTool: { tool: string; executed: number; rejected: number }[]; topRejections: { reason: string; count: number }[] };
  retrieval: { turns: number; turnsWithMemories: number; unavailable: number; avgRecalled: number | null; avgTopSimilarity: number | null; avgScore: number | null };
  nodes: { node: string; count: number; avgMs: number | null }[];
  simulation: { ticks: number; executed: number; rejected: number; skipped: number; avgTickMs: number | null };
};

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="rounded-md border border-line p-2.5">
      <p className="text-[0.7rem] text-dim">{label}</p>
      <p className="font-mono text-sm">{value}</p>
      {hint && <p className="text-[0.65rem] text-dim">{hint}</p>}
    </div>
  );
}

export function MetricsPanel({ sessionId, refreshKey }: { sessionId: string; refreshKey: number }) {
  const [m, setM] = useState<Metrics | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    const controller = new AbortController();
    api<{ metrics: Metrics }>(`/api/sessions/${sessionId}/metrics`, { signal: controller.signal })
      .then((r) => setM(r.metrics))
      .catch((e) => !controller.signal.aborted && setError(e instanceof ApiError ? e.message : "Couldn't load metrics"));
    return () => controller.abort();
  }, [sessionId, refreshKey]);
  if (error) return <p role="alert" className="text-sm text-danger">{error}</p>;
  if (!m) return <div className="h-24 animate-pulse rounded-md border border-line bg-panel-2" />;
  if (m.runs.total === 0 && m.simulation.ticks === 0) return <p className="py-8 text-center text-sm text-dim">No agent activity yet in this investigation.</p>;
  const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "–");
  return (
    <div className="space-y-4">
      <p className="text-xs text-dim">Measured: latency (server timers) and tokens (Ollama&apos;s counts). Estimated: cost.</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        <Stat label="Runs" value={`${m.runs.total}`} hint={`${m.runs.byStatus.SUCCEEDED} ok · ${m.runs.byStatus.FAILED} failed · ${m.runs.byStatus.CANCELLED} cancelled`} />
        <Stat label="Latency p50 / p95 (measured)" value={`${ms(m.latencyMs.p50)} / ${ms(m.latencyMs.p95)}`} />
        <Stat label="Tokens in / out (measured)" value={`${m.tokens.input} / ${m.tokens.output}`} hint={`${m.tokens.modelCalls} model calls · ${m.tokens.retries} retries`} />
        <Stat label="Cost (estimate)" value={`$${m.cost.usd.toFixed(4)}`} hint={m.cost.note} />
        <Stat label="Turns with memories" value={pct(m.retrieval.turnsWithMemories, m.retrieval.turns)} hint={`avg ${m.retrieval.avgRecalled ?? "–"} recalled · ${m.retrieval.unavailable} unavailable`} />
        <Stat label="Retrieval quality" value={`top sim ${m.retrieval.avgTopSimilarity ?? "–"}`} hint={`avg score ${m.retrieval.avgScore ?? "–"}`} />
      </div>
      <section aria-label="Tool call metrics">
        <h4 className="mb-2 font-display text-sm font-semibold">Tool calls</h4>
        <table className="w-full text-left text-xs">
          <thead className="text-dim">
            <tr>
              <th className="py-1 font-normal">Tool</th>
              <th className="py-1 text-right font-normal">Executed</th>
              <th className="py-1 text-right font-normal">Rejected</th>
            </tr>
          </thead>
          <tbody>
            {m.tools.byTool.map((t) => (
              <tr key={t.tool} className="border-t border-line">
                <td className="py-1 font-mono">{t.tool}</td>
                <td className="py-1 text-right font-mono">{t.executed}</td>
                <td className="py-1 text-right font-mono text-danger/90">{t.rejected}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {m.tools.topRejections.length > 0 && (
          <ul className="mt-2 space-y-1 text-xs text-dim">
            {m.tools.topRejections.map((r) => (
              <li key={r.reason}>
                <span className="font-mono">{r.count}×</span> {r.reason}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section aria-label="Time per graph node">
        <h4 className="mb-2 font-display text-sm font-semibold">Average time per node (measured)</h4>
        <ul className="space-y-1">
          {m.nodes.map((n) => (
            <li key={n.node} className="flex items-center gap-2 text-xs">
              <span className="w-36 shrink-0">{NODE_LABEL[n.node] ?? n.node}</span>
              <span className="h-1.5 rounded bg-cyan/60" style={{ width: `${Math.max(2, Math.min(100, ((n.avgMs ?? 0) / Math.max(1, m.nodes[0]?.avgMs ?? 1)) * 100))}%` }} aria-hidden="true" />
              <span className="ml-auto font-mono text-dim">{ms(n.avgMs)}</span>
            </li>
          ))}
        </ul>
      </section>
      <Stat label="Simulation" value={`${m.simulation.ticks} ticks`} hint={`${m.simulation.executed} actions · ${m.simulation.rejected} rejected · ${m.simulation.skipped} skipped`} />
    </div>
  );
}

export function CompareRuns({ a, b }: { a: RunDetail; b: RunDetail }) {
  const nodes = [...new Set([...a.steps.map((s) => s.node), ...b.steps.map((s) => s.node)])];
  const step = (r: RunDetail, node: string) => r.steps.find((s) => s.node === node);
  const rows: [string, string, string][] = [
    ["NPC", a.npc?.name ?? "–", b.npc?.name ?? "–"],
    ["Model", `${a.provider}/${a.model}`, `${b.provider}/${b.model}`],
    ["Status", a.status.toLowerCase(), b.status.toLowerCase()],
    ["Latency", ms(a.latencyMs), ms(b.latencyMs)],
    ["Tokens", `${a.inputTokens ?? 0}/${a.outputTokens ?? 0}`, `${b.inputTokens ?? 0}/${b.outputTokens ?? 0}`],
    ["Tool calls", `${a.tools.total} (${a.tools.rejected} rejected)`, `${b.tools.total} (${b.tools.rejected} rejected)`],
  ];
  return (
    <div className="space-y-3">
      <table className="w-full text-left text-xs" aria-label="Run comparison">
        <thead className="text-dim">
          <tr>
            <th className="py-1 font-normal" />
            <th className="py-1 font-normal">Run {a.id.slice(-6)}</th>
            <th className="py-1 font-normal">Run {b.id.slice(-6)}</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(([k, x, y]) => (
            <tr key={k} className="border-t border-line">
              <td className="py-1 text-dim">{k}</td>
              <td className="py-1 font-mono">{x}</td>
              <td className="py-1 font-mono">{y}</td>
            </tr>
          ))}
          {nodes.map((n) => (
            <tr key={n} className="border-t border-line align-top">
              <td className="py-1 text-dim">{NODE_LABEL[n] ?? n}</td>
              <td className="py-1">{step(a, n) ? <span className="font-mono">{ms(step(a, n)!.durationMs)}</span> : <span className="text-dim">skipped</span>}</td>
              <td className="py-1">{step(b, n) ? <span className="font-mono">{ms(step(b, n)!.durationMs)}</span> : <span className="text-dim">skipped</span>}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="grid gap-2 sm:grid-cols-2">
        {[a, b].map((r) => (
          <div key={r.id} className="rounded-md border border-line p-2 text-xs">
            <p className="text-dim">Tools in run {r.id.slice(-6)}</p>
            <ul className="mt-1 space-y-0.5">
              {r.toolExecutions.length === 0 && <li className="text-dim">none</li>}
              {r.toolExecutions.map((t) => (
                <li key={t.id} className={t.status === "EXECUTED" ? "" : "text-danger/90"}>
                  {t.status === "EXECUTED" ? "✓" : "✗"} {t.tool}
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </div>
  );
}

type Replay = { dryRun: true; note: string; comparisons: { tool: string; args: unknown; then: { status: string; reason: string | null }; now: { status: string; reason: string | null } }[] };

export function ReplayButton({ sessionId, runId }: { sessionId: string; runId: string }) {
  const [replay, setReplay] = useState<Replay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  return (
    <section aria-label="Policy replay">
      <button
        type="button"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            setReplay((await api<{ replay: Replay }>(`/api/sessions/${sessionId}/runs/${runId}/replay`, { method: "POST", body: {} })).replay);
          } catch (e) {
            setError(e instanceof ApiError ? e.message : "Replay failed");
          } finally {
            setBusy(false);
          }
        }}
        className="rounded-md border border-line px-3 py-1.5 text-xs transition-colors hover:border-cyan/60 disabled:opacity-50"
      >
        {busy ? "Replaying…" : "Replay policy (dry run)"}
      </button>
      {error && <p role="alert" className="mt-2 text-xs text-danger">{error}</p>}
      {replay && (
        <div className="mt-2 space-y-1 text-xs">
          <p className="text-dim">{replay.note}</p>
          {replay.comparisons.map((c, i) => (
            <p key={i} className={c.then.status === c.now.status || (c.then.status === "executed" && c.now.status === "approved") ? "" : "text-amber"}>
              <span className="font-mono">{c.tool}</span>: then {c.then.status}
              {c.then.reason ? ` (${c.then.reason})` : ""} → now {c.now.status}
              {c.now.reason ? ` (${c.now.reason})` : ""}
            </p>
          ))}
        </div>
      )}
    </section>
  );
}

type SimulationInfo = {
  paused: boolean;
  tick: number;
  everyTurns: number;
  maxActionsPerTick: number;
  ticks: { tick: number; trigger: string; durationMs: number; createdAt: string; actions: { intention: string; actor: string; title: string; status: string; reason?: string; outcomes: { status: string; text: string }[] }[] }[];
};

export function SimulationPanel({ sessionId, refreshKey, onView }: { sessionId: string; refreshKey: number; onView: (view: unknown) => void }) {
  const [sim, setSim] = useState<SimulationInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    api<{ simulation: SimulationInfo }>(`/api/sessions/${sessionId}/simulation`, { signal: controller.signal })
      .then((r) => setSim(r.simulation))
      .catch((e) => !controller.signal.aborted && setError(e instanceof ApiError ? e.message : "Couldn't load the simulation"));
    return () => controller.abort();
  }, [sessionId, refreshKey]);

  async function control(action: "pause" | "resume" | "step") {
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ simulation: SimulationInfo; view: unknown }>(`/api/sessions/${sessionId}/simulation`, {
        method: "POST",
        body: action === "step" ? { action, idempotencyKey: crypto.randomUUID() } : { action },
      });
      setSim(r.simulation);
      onView(r.view);
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "That didn't work");
    } finally {
      setBusy(false);
    }
  }

  if (!sim) return error ? <p role="alert" className="text-sm text-danger">{error}</p> : <div className="h-24 animate-pulse rounded-md border border-line bg-panel-2" />;
  return (
    <div className="space-y-3">
      <p className="text-sm">
        Tick <span className="font-mono">{sim.tick}</span> · every {sim.everyTurns} player turns · at most {sim.maxActionsPerTick} actions per tick ·{" "}
        <span className={sim.paused ? "text-amber" : "text-cyan"}>{sim.paused ? "paused" : "running"}</span>
      </p>
      <div className="flex flex-wrap gap-2" aria-label="Simulation controls (development)">
        <button type="button" disabled={busy} onClick={() => void control(sim.paused ? "resume" : "pause")} className="rounded-md border border-line px-3 py-1.5 text-xs hover:border-cyan/60 disabled:opacity-50">
          {sim.paused ? "Resume" : "Pause"}
        </button>
        <button type="button" disabled={busy} onClick={() => void control("step")} className="rounded-md border border-line px-3 py-1.5 text-xs hover:border-cyan/60 disabled:opacity-50">
          Step one tick
        </button>
      </div>
      {error && <p role="alert" className="text-xs text-danger">{error}</p>}
      {sim.ticks.length === 0 && <p className="py-6 text-center text-sm text-dim">The city hasn&apos;t moved yet. It acts every {sim.everyTurns} turns.</p>}
      <ol className="space-y-2" aria-label="Simulation history">
        {sim.ticks.map((t) => (
          <li key={t.tick} className="rounded-md border border-line p-2.5 text-xs">
            <p className="flex items-center gap-2">
              <span className="font-mono">tick {t.tick}</span> <span className="text-dim">{t.trigger.toLowerCase()}</span>
              <span className="ml-auto font-mono text-dim">{ms(t.durationMs)}</span>
            </p>
            {t.actions.length === 0 && <p className="mt-1 text-dim">No intention&apos;s conditions held.</p>}
            <ul className="mt-1 space-y-1">
              {t.actions.map((a, i) => (
                <li key={i}>
                  <span className={a.status === "executed" ? "text-cyan" : a.status === "rejected" ? "text-danger" : "text-dim"}>{a.status}</span> · <span className="font-mono">{a.actor}</span> · {a.title}
                  {a.reason && <span className="block text-dim">{a.reason}</span>}
                  {a.status === "executed" && <span className="block text-text/70">{a.outcomes.filter((o) => o.status === "applied").map((o) => o.text).join(" · ")}</span>}
                </li>
              ))}
            </ul>
          </li>
        ))}
      </ol>
    </div>
  );
}
