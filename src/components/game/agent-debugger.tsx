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

function RunDetailView({ run }: { run: RunDetail }) {
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

  if (selected) {
    return (
      <div>
        <button type="button" onClick={() => setSelected(null)} className="mb-3 text-sm text-cyan underline-offset-4 hover:underline">
          ← All runs
        </button>
        <RunDetailView run={selected} />
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
          <li key={r.id}>
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
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sessionId: string;
  liveEvents: TurnStreamEvent[];
  refreshKey: number;
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
          </TabsList>
          <TabsContent value="live" className={cn("pt-3")}>
            <LiveTurn events={liveEvents} />
          </TabsContent>
          <TabsContent value="runs" className="pt-3">
            <RunsHistory sessionId={sessionId} refreshKey={refreshKey} />
          </TabsContent>
        </Tabs>
      </SheetContent>
    </Sheet>
  );
}
