"use client";

import { Lock, Navigation, Radio, ScanSearch } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { GameView } from "@/lib/game-types";
import { cn } from "@/lib/utils";
import type { Command } from "./game-client";

function Bar({ value, min, max, color, label }: { value: number; min: number; max: number; color: string; label: string }) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div className="flex items-center gap-2" title={`${label}: ${value}`}>
      <span className="w-16 text-xs text-dim">{label}</span>
      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-ink" role="meter" aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value}>
        <div className="h-full rounded-full transition-[width] duration-500" style={{ width: `${pct}%`, background: color }} />
      </div>
      <span className="w-8 text-right font-mono text-xs text-dim">{value}</span>
    </div>
  );
}

export function CityPanel({
  view,
  selectedNpc,
  onSelectNpc,
  run,
  busy,
  narration,
}: {
  view: GameView;
  selectedNpc: string | null;
  onSelectNpc: (key: string) => void;
  run: (command: Command) => void;
  busy: boolean;
  narration: string[];
}) {
  const { location } = view;
  return (
    <div className="flex flex-col gap-4">
      {/* Where you are */}
      <section className="frame overflow-hidden" style={{ ["--frame-accent" as string]: location.accent }} aria-labelledby="location-title">
        <div
          className="relative h-24 border-b border-line"
          style={{ background: `linear-gradient(120deg, color-mix(in oklab, ${location.accent} 35%, var(--ink)), var(--ink) 70%)` }}
          aria-hidden="true"
        >
          <div className="scanlines absolute inset-0" />
          <p className="absolute bottom-2 left-4 font-mono text-xs text-text/70">{location.district}</p>
        </div>
        <div className="p-4">
          <h2 id="location-title" className="font-display text-2xl font-bold">
            {location.name}
          </h2>
          <p className="mt-2 text-sm text-text/80">{location.description}</p>
          <p className="mt-2 text-sm italic text-dim">{location.ambience}</p>
          <Button onClick={() => run({ type: "investigate" })} disabled={busy} variant="outline" className="mt-4 w-full border-cyan/50 hover:border-cyan">
            <ScanSearch aria-hidden="true" /> {location.investigated ? "Search again" : "Investigate this area"}
          </Button>
          {narration.length > 0 && (
            <div className="mt-4 space-y-2 border-l-2 border-cyan/60 pl-3 text-sm" aria-live="polite">
              {narration.map((line, i) => (
                <p key={i} className="text-text/85">
                  {line}
                </p>
              ))}
            </div>
          )}
        </div>
      </section>

      {/* Who is here */}
      <section className="frame p-4" aria-labelledby="people-title">
        <h2 id="people-title" className="font-display text-lg font-semibold">
          People here
        </h2>
        {view.npcsHere.length === 0 && <p className="mt-2 text-sm text-dim">Nobody worth talking to.</p>}
        <ul className="mt-3 space-y-2">
          {view.npcsHere.map((npc) => {
            const active = npc.key === selectedNpc;
            return (
              <li key={npc.key}>
                <button
                  type="button"
                  onClick={() => onSelectNpc(npc.key)}
                  aria-pressed={active}
                  className={cn(
                    "w-full rounded-md border p-3 text-left transition-colors",
                    active ? "border-[color:var(--npc)] bg-[color-mix(in_oklab,var(--npc)_10%,transparent)]" : "border-line hover:border-[color:var(--npc)]/60",
                  )}
                  style={{ ["--npc" as string]: npc.accent }}
                >
                  <span className="flex items-center justify-between gap-2">
                    <span className="font-display text-base font-semibold">{npc.name}</span>
                    {npc.remote && (
                      <span className="inline-flex items-center gap-1 text-xs text-dim">
                        <Radio className="size-3" aria-hidden="true" /> relay
                      </span>
                    )}
                  </span>
                  <span className="block text-xs" style={{ color: npc.accent }}>
                    {npc.title}
                  </span>
                  <span className="mt-2 block space-y-1">
                    <Bar value={npc.trust} min={-100} max={100} color="var(--cyan)" label="Trust" />
                    <Bar value={npc.suspicion} min={0} max={100} color="var(--danger)" label="Suspicion" />
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* Where you can go */}
      <section className="frame p-4" aria-labelledby="travel-title">
        <h2 id="travel-title" className="font-display text-lg font-semibold">
          Travel
        </h2>
        <ul className="mt-3 space-y-2">
          {view.locations.map((l) => (
            <li key={l.key}>
              {l.current ? (
                <div className="flex items-center gap-2 rounded-md border border-line bg-ink/60 px-3 py-2 text-sm">
                  <span className="size-2 rounded-full" style={{ background: l.accent }} aria-hidden="true" />
                  <span className="font-medium">{l.name}</span>
                  <span className="ml-auto text-xs text-dim">You are here</span>
                </div>
              ) : l.unlocked ? (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => run({ type: "travel", locationKey: l.key })}
                  className="flex w-full items-center gap-2 rounded-md border border-line px-3 py-2 text-left text-sm transition-colors hover:border-cyan/60 disabled:opacity-50"
                >
                  <span className="size-2 rounded-full" style={{ background: l.accent }} aria-hidden="true" />
                  <span>{l.name}</span>
                  <Navigation className="ml-auto size-3.5 text-cyan" aria-hidden="true" />
                  <span className="sr-only">Travel there</span>
                </button>
              ) : (
                <div className="rounded-md border border-dashed border-line px-3 py-2 text-sm text-dim">
                  <span className="flex items-center gap-2">
                    <Lock className="size-3.5" aria-hidden="true" /> {l.name}
                  </span>
                  {l.lockedReason && <span className="mt-1 block text-xs">{l.lockedReason}</span>}
                </div>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
