"use client";

import { CheckCircle2, Circle, FileSearch, Network, Package, ScrollText, Siren } from "lucide-react";
import { CaseBoard } from "./case-board";
import type { Command } from "./game-client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import type { GameView, Reliability, Severity } from "@/lib/game-types";
import { cn } from "@/lib/utils";

const RELIABILITY: Record<Reliability, string> = {
  CONFIRMED: "text-cyan border-cyan/40",
  LIKELY: "text-amber border-amber/40",
  UNVERIFIED: "text-dim border-line",
  DISPUTED: "text-danger border-danger/40",
};
const RARITY: Record<string, string> = { COMMON: "text-dim", RARE: "text-cyan", EPIC: "text-violet", LEGENDARY: "text-amber" };
const SEVERITY: Record<Severity, string> = { INFO: "border-line", NOTICE: "border-cyan/60", WARNING: "border-amber/70", CRITICAL: "border-danger" };

const provenanceText = (p: string) =>
  p.startsWith("investigated:") ? `Found while investigating` : p.startsWith("given-by:") ? `Given by ${p.slice(9).replace(/^./, (c) => c.toUpperCase())}` : p;

export function Journal({ view, run, busy }: { view: GameView; run: (command: Command) => Promise<boolean>; busy: boolean }) {
  const activeCount = view.quests.filter((q) => q.status === "ACTIVE").length;
  return (
    <Tabs defaultValue="quests" className="frame gap-0 p-0">
      <TabsList className="w-full rounded-none border-b border-line bg-transparent p-1">
        <TabsTrigger value="quests" className="gap-1.5">
          <ScrollText aria-hidden="true" /> Quests{activeCount > 0 && <span className="font-mono text-xs text-pink">{activeCount}</span>}
        </TabsTrigger>
        <TabsTrigger value="inventory" className="gap-1.5">
          <Package aria-hidden="true" /> Items <span className="font-mono text-xs text-dim">{view.inventory.length}</span>
        </TabsTrigger>
        <TabsTrigger value="evidence" className="gap-1.5">
          <FileSearch aria-hidden="true" /> Evidence <span className="font-mono text-xs text-dim">{view.evidence.length}</span>
        </TabsTrigger>
        <TabsTrigger value="case" className="gap-1.5">
          <Network aria-hidden="true" /> Case
        </TabsTrigger>
      </TabsList>

      <TabsContent value="case" className="p-0">
        <CaseBoard view={view} run={run} busy={busy} />
      </TabsContent>

      <TabsContent value="quests" className="space-y-4 p-4">
        {view.quests.length === 0 && <p className="text-sm text-dim">No quests yet. Someone in the Slums is looking for help: talk to Balthazar.</p>}
        {[...view.quests].sort((a, b) => Number(a.status !== "ACTIVE") - Number(b.status !== "ACTIVE")).map((q) => (
          <article key={q.key} className={cn("rounded-md border p-3", q.status === "ACTIVE" ? "border-pink/40" : "border-line opacity-80")}>
            <header className="flex items-start justify-between gap-2">
              <h3 className="font-display text-base font-semibold">{q.title}</h3>
              <span className={cn("shrink-0 font-mono text-[0.7rem]", q.status === "ACTIVE" ? "text-pink" : "text-cyan")}>{q.status === "ACTIVE" ? "active" : "complete"}</span>
            </header>
            <p className="mt-1 text-sm text-dim">{q.summary}</p>
            <ul className="mt-3 space-y-1.5">
              {q.objectives.map((o) => (
                <li key={o.key} className={cn("flex gap-2 text-sm", o.done ? "text-dim line-through decoration-dim/50" : "")}>
                  {o.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-cyan" aria-label="Done" /> : <Circle className="mt-0.5 size-4 shrink-0 text-dim" aria-label="Open" />}
                  <span>{o.description}</span>
                </li>
              ))}
            </ul>
            {q.status === "COMPLETED" && q.rewardText && <p className="mt-3 border-t border-line pt-2 text-sm italic text-text/80">{q.rewardText}</p>}
            {q.status === "ACTIVE" && q.rewardCredits > 0 && <p className="mt-3 font-mono text-xs text-amber">Reward: ¤{q.rewardCredits}</p>}
          </article>
        ))}
      </TabsContent>

      <TabsContent value="inventory" className="p-4">
        <ul className="space-y-2">
          {view.inventory.map((i) => (
            <li key={i.key} className="rounded-md border border-line p-3">
              <p className="flex items-center justify-between gap-2">
                <span className="font-medium">
                  {i.name}
                  {i.quantity > 1 && <span className="ml-1 font-mono text-xs text-dim">×{i.quantity}</span>}
                </span>
                <span className={cn("font-mono text-[0.7rem]", RARITY[i.rarity])}>{i.rarity.toLowerCase()}</span>
              </p>
              <p className="mt-1 text-sm text-dim">{i.description}</p>
            </li>
          ))}
        </ul>
      </TabsContent>

      <TabsContent value="evidence" className="p-4">
        {view.evidence.length === 0 && <p className="text-sm text-dim">No evidence yet. Investigate locations and listen to what people tell you.</p>}
        <ul className="space-y-2">
          {view.evidence.map((e) => (
            <li key={e.key} className="rounded-md border border-line p-3">
              <p className="flex items-start justify-between gap-2">
                <span className="font-medium">{e.title}</span>
                <span className={cn("shrink-0 rounded border px-1.5 font-mono text-[0.65rem]", RELIABILITY[e.reliability])}>{e.reliability.toLowerCase()}</span>
              </p>
              <p className="mt-1 text-sm text-text/80">{e.description}</p>
              <p className="mt-2 text-xs text-dim">{provenanceText(e.provenance)}</p>
            </li>
          ))}
        </ul>
      </TabsContent>
    </Tabs>
  );
}

export function EventFeed({ view }: { view: GameView }) {
  return (
    <section className="frame p-4" aria-labelledby="feed-title">
      <h2 id="feed-title" className="flex items-center gap-2 font-display text-lg font-semibold">
        <Siren className="size-4 text-cyan" aria-hidden="true" /> City feed
      </h2>
      <ol className="mt-3 space-y-3">
        {view.events.map((e) => (
          <li key={e.id} className={cn("border-l-2 pl-3", SEVERITY[e.severity])}>
            <p className="text-sm font-medium">{e.title}</p>
            <p className="text-xs text-dim">{e.description}</p>
          </li>
        ))}
      </ol>
    </section>
  );
}
