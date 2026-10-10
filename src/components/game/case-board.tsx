"use client";

import { useState } from "react";
import { FileWarning, Gavel, Network, Pin, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { GameView } from "@/lib/game-types";
import { cn } from "@/lib/utils";
import type { Command } from "./game-client";

type Investigation = GameView["investigation"];
type Relation = Investigation["links"][number]["relation"];

const RELATION: Record<Relation, { label: string; color: string; dash?: string }> = {
  SUPPORTS: { label: "supports", color: "var(--cyan)" },
  LEADS_TO: { label: "leads to", color: "var(--dim)", dash: "4 4" },
  CONTRADICTS: { label: "contradicts", color: "var(--amber)", dash: "2 3" },
  IMPLICATES: { label: "implicates", color: "var(--danger)" },
  EXONERATES: { label: "clears", color: "#5ee38f" },
};

const VERDICT: Record<string, string> = { strong: "text-cyan", plausible: "text-amber", weak: "text-dim", contradicted: "text-danger" };

/** The evidence network: discovered evidence on the left, suspects on the right, links between them. */
function EvidenceGraph({ view }: { view: GameView }) {
  const evidence = view.evidence;
  const suspects = view.investigation.suspects;
  const rowH = 46;
  const height = Math.max(evidence.length, suspects.length, 2) * rowH + 24;
  const ey = (key: string) => 24 + evidence.findIndex((e) => e.key === key) * rowH;
  const sy = (key: string) => 24 + suspects.findIndex((s) => s.key === key) * ((height - 48) / Math.max(1, suspects.length - 1 || 1));
  const EX = 210;
  const SX = 470;

  return (
    <svg viewBox={`0 0 640 ${height}`} className="hidden w-full md:block" role="img" aria-label="Evidence network">
      {view.investigation.links.map((l, i) => {
        const r = RELATION[l.relation];
        if (l.toType === "suspect") {
          return <line key={i} x1={EX} y1={ey(l.from)} x2={SX} y2={sy(l.to)} stroke={r.color} strokeWidth="1.5" strokeDasharray={r.dash} opacity="0.85" />;
        }
        const y1 = ey(l.from);
        const y2 = ey(l.to);
        const bend = 40 + Math.abs(y2 - y1) * 0.25;
        return <path key={i} d={`M ${EX} ${y1} C ${EX + bend} ${y1}, ${EX + bend} ${y2}, ${EX} ${y2}`} fill="none" stroke={r.color} strokeWidth="1.5" strokeDasharray={r.dash} opacity="0.85" />;
      })}
      {evidence.map((e) => (
        <g key={e.key} transform={`translate(0 ${ey(e.key)})`}>
          <rect x="0" y="-15" width={EX} height="30" rx="5" fill="var(--panel-2)" stroke="var(--line)" />
          <text x="10" y="4" fill="var(--text)" fontSize="12">
            {e.title.length > 28 ? `${e.title.slice(0, 27)}…` : e.title}
          </text>
        </g>
      ))}
      {suspects.map((s) => (
        <g key={s.key} transform={`translate(${SX} ${sy(s.key)})`}>
          <rect x="0" y="-15" width="170" height="30" rx="15" fill="color-mix(in oklab, var(--danger) 12%, var(--panel))" stroke="color-mix(in oklab, var(--danger) 50%, transparent)" />
          <text x="14" y="4" fill="var(--text)" fontSize="12">
            {s.name}
          </text>
        </g>
      ))}
    </svg>
  );
}

export function CaseBoard({ view, run, busy }: { view: GameView; run: (command: Command) => Promise<boolean>; busy: boolean }) {
  const inv = view.investigation;
  const [suspect, setSuspect] = useState<string>(inv.suspects[0]?.key ?? "");
  const [picked, setPicked] = useState<string[]>([]);
  const [note, setNote] = useState("");
  const [confirming, setConfirming] = useState(false);
  const title = (key: string) => view.evidence.find((e) => e.key === key)?.title ?? key;
  const suspectName = (key: string) => inv.suspects.find((s) => s.key === key)?.name ?? key;
  const toggle = (key: string) => setPicked((p) => (p.includes(key) ? p.filter((k) => k !== key) : [...p, key]));

  if (inv.suspects.length === 0) return <p className="p-4 text-sm text-dim">This scenario has no suspects.</p>;

  return (
    <div className="space-y-5 p-4">
      <section aria-labelledby="graph-title">
        <h3 id="graph-title" className="flex items-center gap-2 font-display text-base font-semibold">
          <Network className="size-4 text-cyan" aria-hidden="true" /> Evidence network
        </h3>
        {view.evidence.length === 0 ? (
          <p className="mt-2 text-sm text-dim">No evidence yet. Investigate locations and talk to people.</p>
        ) : (
          <>
            <EvidenceGraph view={view} />
            <ul className="mt-2 space-y-1.5 text-sm" aria-label="Links between evidence and suspects">
              {inv.links.length === 0 && <li className="text-dim">No connections yet: find more evidence.</li>}
              {inv.links.map((l, i) => (
                <li key={i} className="flex gap-2">
                  <span className="mt-1.5 h-0.5 w-4 shrink-0" style={{ background: RELATION[l.relation].color }} aria-hidden="true" />
                  <span>
                    <strong className="font-medium">{title(l.from)}</strong> {RELATION[l.relation].label}{" "}
                    <strong className="font-medium">{l.toType === "suspect" ? suspectName(l.to) : title(l.to)}</strong>
                    <span className="block text-xs text-dim">{l.note}</span>
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section aria-labelledby="suspects-title">
        <h3 id="suspects-title" className="font-display text-base font-semibold">
          Suspects
        </h3>
        <ul className="mt-2 grid gap-2">
          {inv.suspects.map((s) => (
            <li key={s.key} className="rounded-md border border-line p-3">
              <p className="font-medium">{s.name}</p>
              <p className="text-xs text-dim">{s.title}</p>
              <p className="mt-1 text-sm text-text/80">{s.description}</p>
              <p className="mt-1 text-xs text-dim">Possible motive: {s.motive}</p>
            </li>
          ))}
        </ul>
      </section>

      {!inv.ending && (
        <section aria-labelledby="theory-title" className="rounded-md border border-line p-3">
          <h3 id="theory-title" className="font-display text-base font-semibold">
            Build a theory
          </h3>
          <label className="mt-2 block text-sm">
            Who did it?
            <select value={suspect} onChange={(e) => setSuspect(e.target.value)} className="mt-1 block w-full rounded-md border border-input bg-ink px-2 py-1.5 text-sm">
              {inv.suspects.map((s) => (
                <option key={s.key} value={s.key}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
          <fieldset className="mt-3">
            <legend className="text-sm">With which evidence?</legend>
            {view.evidence.length === 0 && <p className="text-xs text-dim">Find evidence first.</p>}
            <div className="mt-1 flex flex-wrap gap-1.5">
              {view.evidence.map((e) => (
                <button
                  key={e.key}
                  type="button"
                  aria-pressed={picked.includes(e.key)}
                  onClick={() => toggle(e.key)}
                  className={cn("rounded-full border px-2.5 py-1 text-xs transition-colors", picked.includes(e.key) ? "border-pink bg-pink/15 text-text" : "border-line text-dim hover:text-text")}
                >
                  {e.title}
                </button>
              ))}
            </div>
          </fieldset>
          <label className="mt-3 block text-sm">
            Note <span className="text-dim">(optional)</span>
            <input value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} className="mt-1 block w-full rounded-md border border-input bg-ink px-2 py-1.5 text-sm" />
          </label>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              size="sm"
              variant="outline"
              disabled={busy || picked.length === 0}
              onClick={async () => {
                if (await run({ type: "save_hypothesis", suspectKey: suspect, evidenceKeys: picked, note })) setNote("");
              }}
            >
              <Pin aria-hidden="true" /> Pin theory to the board
            </Button>
            <Button size="sm" disabled={busy || picked.length === 0 || !inv.canSubmit} onClick={() => setConfirming(true)} title={inv.canSubmit ? undefined : "You can submit once the Project Genesis case is open"}>
              <Gavel aria-hidden="true" /> Submit the case
            </Button>
          </div>
          {!inv.canSubmit && <p className="mt-2 text-xs text-dim">The case can be submitted once the Project Genesis investigation is open.</p>}
        </section>
      )}

      {inv.hypotheses.length > 0 && (
        <section aria-labelledby="theories-title">
          <h3 id="theories-title" className="font-display text-base font-semibold">
            Your theories
          </h3>
          <ul className="mt-2 space-y-2">
            {inv.hypotheses.map((h) => (
              <li key={h.id} className="rounded-md border border-line p-3 text-sm">
                <div className="flex items-start justify-between gap-2">
                  <p>
                    <strong className="font-medium">{suspectName(h.suspectKey)}</strong> <span className={cn("font-mono text-xs", VERDICT[h.assessment.verdict])}>{h.assessment.verdict}</span>
                  </p>
                  {!inv.ending && (
                    <button type="button" disabled={busy} onClick={() => void run({ type: "discard_hypothesis", hypothesisId: h.id })} className="text-dim hover:text-danger" aria-label="Discard this theory">
                      <Trash2 className="size-4" />
                    </button>
                  )}
                </div>
                <p className="mt-1 text-xs text-dim">{h.evidenceKeys.map(title).join(" · ")}</p>
                {h.note && <p className="mt-1 text-xs italic">{h.note}</p>}
                <ul className="mt-2 list-disc space-y-0.5 pl-4 text-xs text-text/80">
                  {h.assessment.reasons.map((r, i) => (
                    <li key={i}>{r}</li>
                  ))}
                </ul>
              </li>
            ))}
          </ul>
        </section>
      )}

      <Dialog open={confirming} onOpenChange={setConfirming}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 font-display">
              <FileWarning className="size-5 text-amber" aria-hidden="true" /> Submit your case?
            </DialogTitle>
            <DialogDescription>
              You accuse <strong>{suspectName(suspect)}</strong> with {picked.length} piece{picked.length === 1 ? "" : "s"} of evidence. This ends the investigation; you can&apos;t change it afterwards.
            </DialogDescription>
          </DialogHeader>
          <ul className="list-disc pl-5 text-sm">
            {picked.map((k) => (
              <li key={k}>{title(k)}</li>
            ))}
          </ul>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirming(false)}>
              Not yet
            </Button>
            <Button
              disabled={busy}
              onClick={async () => {
                setConfirming(false);
                await run({ type: "submit_case", suspectKey: suspect, evidenceKeys: picked });
              }}
            >
              Submit the case
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A decision the city puts to the player (e.g. VEX-404's offer). */
export function ChoiceDialog({ view, run, busy }: { view: GameView; run: (command: Command) => Promise<boolean>; busy: boolean }) {
  const choice = view.choices[0];
  if (!choice) return null;
  return (
    <Dialog open>
      <DialogContent showCloseButton={false}>
        <DialogHeader>
          <DialogTitle className="font-display text-xl">{choice.title}</DialogTitle>
          <DialogDescription className="text-text/85">{choice.prompt}</DialogDescription>
        </DialogHeader>
        <div className="grid gap-2">
          {choice.options.map((o) => (
            <button
              key={o.key}
              type="button"
              disabled={busy}
              onClick={() => void run({ type: "choose", choiceKey: choice.key, optionKey: o.key })}
              className="rounded-md border border-line p-3 text-left transition-colors hover:border-pink/60 disabled:opacity-50"
            >
              <span className="font-medium">{o.label}</span>
              <span className="block text-sm text-dim">{o.description}</span>
            </button>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}

const TONE: Record<string, string> = { triumph: "var(--cyan)", bittersweet: "var(--amber)", dark: "var(--danger)", neutral: "var(--dim)" };

/** Shown when the case is closed. */
export function EndingBanner({ view }: { view: GameView }) {
  const ending = view.investigation.ending;
  if (!ending) return null;
  const suspect = view.investigation.suspects.find((s) => s.key === ending.suspectKey)?.name ?? ending.suspectKey;
  return (
    <section className="frame mx-auto mb-4 max-w-[1500px] p-5" style={{ ["--frame-accent" as string]: TONE[ending.tone] }} aria-labelledby="ending-title">
      <p className="font-mono text-xs" style={{ color: TONE[ending.tone] }}>
        Case closed · you accused {suspect}
      </p>
      <h2 id="ending-title" className="mt-1 font-display text-3xl font-bold">
        {ending.title}
      </h2>
      <p className="mt-2 max-w-3xl text-text/85">{ending.description}</p>
      <p className="mt-3 text-xs text-dim">Evidence in your file: {ending.evidenceKeys.map((k) => view.evidence.find((e) => e.key === k)?.title ?? k).join(" · ")}</p>
    </section>
  );
}
