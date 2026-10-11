"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowLeft, CheckCircle2, Eye, Rocket, Save } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, ApiError } from "@/lib/api-client";
import { cn } from "@/lib/utils";
import { useAuthRedirect } from "../game/use-auth-redirect";

type Issue = { path: string; message: string };
type Validation = { ok: boolean; issues: Issue[] };
type Definition = Record<string, unknown> & {
  title?: string;
  summary?: string;
  startingCredits?: number;
  simulation?: { everyTurns?: number; maxActionsPerTick?: number };
  npcs?: Npc[];
};
type Npc = Record<string, unknown> & {
  key: string;
  name: string;
  title: string;
  shortBio: string;
  baseTrust: number;
  baseSuspicion: number;
  allowedTools?: string[];
  allowedEffects?: string[];
  persona: Record<string, unknown> & { personality: string; background: string; voice: string; goals: string[]; behavioralRules: string[] };
};
type Draft = { id: string; slug: string; title: string; definition: Definition; validation: Validation; catalog: { tools: string[]; effects: string[] } };

/** Sections edited as JSON. NPCs and the overview have forms. */
const JSON_SECTIONS = [
  ["locations", "Locations"],
  ["items", "Items"],
  ["startingItems", "Starting inventory"],
  ["factions", "Factions"],
  ["quests", "Quests"],
  ["evidence", "Evidence"],
  ["suspects", "Suspects"],
  ["evidenceLinks", "Evidence links"],
  ["choices", "Choices"],
  ["intentions", "NPC & faction intentions"],
  ["endings", "Endings"],
] as const;
type Section = "overview" | "npcs" | (typeof JSON_SECTIONS)[number][0];

const field = "w-full rounded-md border border-line bg-ink px-3 py-2 text-sm text-text focus-visible:outline-2 focus-visible:outline-cyan";

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      {children}
      {hint && <span className="text-xs text-dim">{hint}</span>}
    </label>
  );
}

const omit = (record: Record<string, string>, key: string) => Object.fromEntries(Object.entries(record).filter(([k]) => k !== key));
const lines = (v: string) => v.split("\n").map((l) => l.trim()).filter(Boolean);

export function DraftEditor() {
  const { versionId } = useParams<{ versionId: string }>();
  const router = useRouter();
  const toLogin = useAuthRedirect();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [definition, setDefinition] = useState<Definition | null>(null);
  const [validation, setValidation] = useState<Validation | null>(null);
  const [loadError, setLoadError] = useState<{ status: number; message: string } | null>(null);
  const [section, setSection] = useState<Section>("overview");
  const [npcIndex, setNpcIndex] = useState(0);
  const [jsonText, setJsonText] = useState<Record<string, string>>({});
  const [jsonErrors, setJsonErrors] = useState<Record<string, string>>({});
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState<null | "save" | "preview" | "publish">(null);
  const [confirmPublish, setConfirmPublish] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    api<{ draft: Draft }>(`/api/creator/drafts/${versionId}`, { signal: controller.signal })
      .then(({ draft }) => {
        setDraft(draft);
        setDefinition(draft.definition);
        setValidation(draft.validation);
      })
      .catch((e) => {
        if (controller.signal.aborted || toLogin(e)) return;
        setLoadError(e instanceof ApiError ? { status: e.status, message: e.message } : { status: 500, message: "Couldn't load the draft" });
      });
    return () => controller.abort();
  }, [versionId, toLogin]);

  // Warn before leaving with unsaved edits
  useEffect(() => {
    if (!dirty) return;
    const onLeave = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onLeave);
    return () => window.removeEventListener("beforeunload", onLeave);
  }, [dirty]);

  const update = (patch: Partial<Definition>) => {
    setDefinition((d) => (d ? { ...d, ...patch } : d));
    setDirty(true);
  };
  const updateNpc = (patch: Partial<Npc>) => {
    const npcs = [...(definition?.npcs ?? [])];
    npcs[npcIndex] = { ...npcs[npcIndex], ...patch };
    update({ npcs });
    // The JSON view of the NPC list is rebuilt from the form
    setJsonText((t) => omit(t, "npcs"));
  };
  const updatePersona = (patch: Partial<Npc["persona"]>) => updateNpc({ persona: { ...npc!.persona, ...patch } });

  const npc = definition?.npcs?.[npcIndex];
  const textFor = (key: string) => jsonText[key] ?? JSON.stringify(definition?.[key] ?? [], null, 2);
  const unparsed = Object.keys(jsonErrors).length > 0;

  const issuesBySection = useMemo(() => {
    const counts = new Map<string, number>();
    for (const issue of validation?.issues ?? []) {
      const top = issue.path.split(/[.\s:[]/)[0];
      counts.set(top, (counts.get(top) ?? 0) + 1);
    }
    return counts;
  }, [validation]);

  async function save() {
    if (!definition) return false;
    if (unparsed) {
      toast.error("Fix the JSON errors first");
      return false;
    }
    setBusy("save");
    try {
      const { validation } = await api<{ validation: Validation }>(`/api/creator/drafts/${versionId}`, { method: "PUT", body: { definition } });
      setValidation(validation);
      setDirty(false);
      toast.success(validation.ok ? "Saved. The draft is valid." : `Saved with ${validation.issues.length} problem(s)`);
      return validation.ok;
    } catch (e) {
      if (!toLogin(e)) toast.error(e instanceof ApiError ? e.message : "Couldn't save");
      return false;
    } finally {
      setBusy(null);
    }
  }

  async function preview() {
    if (!(await save())) return;
    setBusy("preview");
    try {
      const { sessionId } = await api<{ sessionId: string }>(`/api/creator/drafts/${versionId}/preview`, { method: "POST", body: {} });
      router.push(`/play/${sessionId}`);
    } catch (e) {
      if (!toLogin(e)) toast.error(e instanceof ApiError ? e.message : "Couldn't start the preview");
      setBusy(null);
    }
  }

  async function publish() {
    setConfirmPublish(false);
    if (!(await save())) return;
    setBusy("publish");
    try {
      const { published } = await api<{ published: { version: number } }>(`/api/creator/drafts/${versionId}/publish`, { method: "POST", body: {} });
      toast.success(`Published as version ${published.version}. Players can now start it.`);
    } catch (e) {
      if (!toLogin(e)) toast.error(e instanceof ApiError ? e.message : "Couldn't publish");
    } finally {
      setBusy(null);
    }
  }

  if (loadError) {
    return (
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-16">
        <div role="alert" className="frame p-6">
          <p className="font-display text-lg font-semibold">{loadError.status === 403 ? "Creator Mode needs the creator role" : "This draft can't be opened"}</p>
          <p className="mt-2 text-dim">{loadError.message}</p>
          <Link href="/creator" className="mt-4 inline-block text-cyan underline underline-offset-2">
            Back to Creator Mode
          </Link>
        </div>
      </main>
    );
  }
  if (!draft || !definition) {
    return (
      <main className="grid flex-1 place-items-center" aria-busy="true">
        <p className="font-mono text-sm text-dim">Loading the draft…</p>
      </main>
    );
  }

  const nav: [Section, string][] = [["overview", "Overview & simulation"], ["npcs", "NPCs"], ...JSON_SECTIONS.map(([k, l]) => [k, l] as [Section, string])];

  return (
    <div className="flex min-h-svh flex-col">
      <header className="sticky top-0 z-20 border-b border-line bg-ink/95 backdrop-blur">
        <div className="mx-auto flex max-w-[1400px] flex-wrap items-center gap-3 px-4 py-3 sm:px-6">
          <Link href="/creator" className="inline-flex items-center gap-1 text-sm text-dim hover:text-text">
            <ArrowLeft className="size-4" aria-hidden="true" /> Creator Mode
          </Link>
          <h1 className="min-w-0 flex-1 truncate font-display text-lg font-semibold">{definition.title ?? draft.title}</h1>
          <span className="text-xs text-dim" aria-live="polite">
            {dirty ? "Unsaved changes" : "Saved"}
          </span>
          <Button variant="outline" size="sm" onClick={save} disabled={busy !== null}>
            <Save aria-hidden="true" /> {busy === "save" ? "Saving…" : "Save & check"}
          </Button>
          <Button variant="outline" size="sm" onClick={preview} disabled={busy !== null || validation?.ok === false}>
            <Eye aria-hidden="true" /> {busy === "preview" ? "Starting…" : "Preview"}
          </Button>
          <Button size="sm" onClick={() => setConfirmPublish(true)} disabled={busy !== null || validation?.ok === false}>
            <Rocket aria-hidden="true" /> {busy === "publish" ? "Publishing…" : "Publish"}
          </Button>
        </div>
      </header>

      <div className="mx-auto grid w-full max-w-[1400px] flex-1 gap-6 px-4 py-6 sm:px-6 lg:grid-cols-[220px_minmax(0,1fr)_300px]">
        <nav aria-label="Scenario sections">
          <ul className="flex gap-1 overflow-x-auto pb-2 lg:flex-col lg:overflow-visible">
            {nav.map(([key, label]) => (
              <li key={key}>
                <button
                  type="button"
                  onClick={() => setSection(key)}
                  aria-current={section === key ? "page" : undefined}
                  className={cn(
                    "flex w-full items-center justify-between gap-2 whitespace-nowrap rounded-md px-3 py-2 text-left text-sm",
                    section === key ? "bg-pink/15 text-text" : "text-dim hover:bg-panel hover:text-text",
                  )}
                >
                  {label}
                  {(issuesBySection.get(key) ?? 0) > 0 && <span className="rounded bg-danger/20 px-1.5 text-xs text-danger">{issuesBySection.get(key)}</span>}
                  {jsonErrors[key] && <AlertTriangle className="size-3.5 text-amber" aria-label="JSON error" />}
                </button>
              </li>
            ))}
          </ul>
        </nav>

        <section className="frame min-w-0 p-5" aria-label={nav.find(([k]) => k === section)?.[1]}>
          {section === "overview" && (
            <div className="grid gap-4">
              <Field label="Title">
                <input className={field} value={definition.title ?? ""} onChange={(e) => update({ title: e.target.value })} />
              </Field>
              <Field label="Summary">
                <textarea className={cn(field, "min-h-24")} value={definition.summary ?? ""} onChange={(e) => update({ summary: e.target.value })} />
              </Field>
              <Field label="Starting credits">
                <input type="number" min={0} className={field} value={definition.startingCredits ?? 0} onChange={(e) => update({ startingCredits: Number(e.target.value) })} />
              </Field>
              <fieldset className="grid gap-4 rounded-md border border-line p-4 sm:grid-cols-2">
                <legend className="px-1 text-sm font-medium">City simulation</legend>
                <Field label="Act every N player turns" hint="1 to 50">
                  <input
                    type="number"
                    min={1}
                    max={50}
                    className={field}
                    value={definition.simulation?.everyTurns ?? 3}
                    onChange={(e) => update({ simulation: { ...definition.simulation, everyTurns: Number(e.target.value) } })}
                  />
                </Field>
                <Field label="Most actions per tick" hint="0 turns the simulation off">
                  <input
                    type="number"
                    min={0}
                    max={10}
                    className={field}
                    value={definition.simulation?.maxActionsPerTick ?? 2}
                    onChange={(e) => update({ simulation: { ...definition.simulation, maxActionsPerTick: Number(e.target.value) } })}
                  />
                </Field>
              </fieldset>
            </div>
          )}

          {section === "npcs" && (
            <div className="grid gap-5">
              <label className="grid gap-1.5 text-sm sm:max-w-xs">
                <span className="font-medium">NPC</span>
                <select className={field} value={npcIndex} onChange={(e) => setNpcIndex(Number(e.target.value))}>
                  {(definition.npcs ?? []).map((n, i) => (
                    <option key={n.key} value={i}>
                      {n.name}
                    </option>
                  ))}
                </select>
              </label>
              {npc && (
                <>
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Field label="Name">
                      <input className={field} value={npc.name} onChange={(e) => updateNpc({ name: e.target.value })} />
                    </Field>
                    <Field label="Title">
                      <input className={field} value={npc.title} onChange={(e) => updateNpc({ title: e.target.value })} />
                    </Field>
                    <Field label="Starting trust">
                      <input type="number" className={field} value={npc.baseTrust} onChange={(e) => updateNpc({ baseTrust: Number(e.target.value) })} />
                    </Field>
                    <Field label="Starting suspicion">
                      <input type="number" className={field} value={npc.baseSuspicion} onChange={(e) => updateNpc({ baseSuspicion: Number(e.target.value) })} />
                    </Field>
                  </div>
                  <Field label="Short bio">
                    <textarea className={cn(field, "min-h-16")} value={npc.shortBio} onChange={(e) => updateNpc({ shortBio: e.target.value })} />
                  </Field>
                  <Field label="Personality">
                    <textarea className={cn(field, "min-h-16")} value={npc.persona.personality} onChange={(e) => updatePersona({ personality: e.target.value })} />
                  </Field>
                  <Field label="Voice">
                    <textarea className={cn(field, "min-h-16")} value={npc.persona.voice} onChange={(e) => updatePersona({ voice: e.target.value })} />
                  </Field>
                  <Field label="Goals" hint="One per line">
                    <textarea className={cn(field, "min-h-20")} value={npc.persona.goals.join("\n")} onChange={(e) => updatePersona({ goals: lines(e.target.value) })} />
                  </Field>
                  <Field label="Behavioural rules" hint="One per line. These go into the NPC's prompt; the engine enforces the permissions below either way.">
                    <textarea
                      className={cn(field, "min-h-20")}
                      value={npc.persona.behavioralRules.join("\n")}
                      onChange={(e) => updatePersona({ behavioralRules: lines(e.target.value) })}
                    />
                  </Field>
                  <fieldset className="rounded-md border border-line p-4">
                    <legend className="px-1 text-sm font-medium">Tools this NPC may propose</legend>
                    <div className="mt-1 grid gap-2 sm:grid-cols-2">
                      {draft.catalog.tools.map((tool) => (
                        <label key={tool} className="flex items-center gap-2 font-mono text-xs">
                          <input
                            type="checkbox"
                            checked={(npc.allowedTools ?? []).includes(tool)}
                            onChange={(e) => updateNpc({ allowedTools: e.target.checked ? [...(npc.allowedTools ?? []), tool] : (npc.allowedTools ?? []).filter((t) => t !== tool) })}
                          />
                          {tool}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <fieldset className="rounded-md border border-line p-4">
                    <legend className="px-1 text-sm font-medium">Effects the engine lets this NPC cause</legend>
                    <div className="mt-1 grid gap-2 sm:grid-cols-2">
                      {draft.catalog.effects.map((effect) => (
                        <label key={effect} className="flex items-center gap-2 font-mono text-xs">
                          <input
                            type="checkbox"
                            checked={(npc.allowedEffects ?? []).includes(effect)}
                            onChange={(e) =>
                              updateNpc({ allowedEffects: e.target.checked ? [...(npc.allowedEffects ?? []), effect] : (npc.allowedEffects ?? []).filter((t) => t !== effect) })
                            }
                          />
                          {effect}
                        </label>
                      ))}
                    </div>
                  </fieldset>
                  <p className="text-xs text-dim">Secrets, known facts, trade offers and trust thresholds: edit them in the full NPC list as JSON below.</p>
                  <JsonEditor
                    label="All NPCs (JSON)"
                    value={textFor("npcs")}
                    error={jsonErrors.npcs}
                    onChange={(text) => setJson("npcs", text)}
                  />
                </>
              )}
            </div>
          )}

          {JSON_SECTIONS.map(
            ([key, label]) =>
              section === key && <JsonEditor key={key} label={`${label} (JSON)`} value={textFor(key)} error={jsonErrors[key]} onChange={(text) => setJson(key, text)} />,
          )}
        </section>

        <aside aria-label="Validation" className="lg:sticky lg:top-20 lg:self-start">
          <div className="frame p-4" aria-live="polite">
            {validation?.ok ? (
              <p className="flex items-center gap-2 font-medium text-cyan">
                <CheckCircle2 className="size-4" aria-hidden="true" /> Valid: ready to preview or publish
              </p>
            ) : (
              <>
                <p className="flex items-center gap-2 font-medium text-danger">
                  <AlertTriangle className="size-4" aria-hidden="true" /> {validation?.issues.length ?? 0} problem(s)
                </p>
                <ul className="mt-3 grid max-h-[60vh] gap-2 overflow-y-auto text-xs">
                  {validation?.issues.map((issue, i) => (
                    <li key={i} className="rounded border border-line bg-ink p-2">
                      <span className="font-mono text-amber">{issue.path}</span>
                      <span className="mt-0.5 block text-dim">{issue.message}</span>
                    </li>
                  ))}
                </ul>
              </>
            )}
            {dirty && <p className="mt-3 text-xs text-dim">Results are from the last save. Save to check your latest edits.</p>}
          </div>
        </aside>
      </div>

      <Dialog open={confirmPublish} onOpenChange={setConfirmPublish}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Publish this scenario?</DialogTitle>
            <DialogDescription>
              This creates a new, unchangeable version that players can start. Investigations already in progress keep the version they began on. You can keep editing
              the draft and publish again later.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConfirmPublish(false)}>
              Cancel
            </Button>
            <Button onClick={publish}>Publish</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );

  function setJson(key: string, text: string) {
    setJsonText((t) => ({ ...t, [key]: text }));
    try {
      const value = JSON.parse(text);
      setJsonErrors((errs) => omit(errs, key));
      update({ [key]: value });
    } catch (e) {
      setJsonErrors((errs) => ({ ...errs, [key]: e instanceof Error ? e.message : "Invalid JSON" }));
      setDirty(true);
    }
  }
}

function JsonEditor({ label, value, error, onChange }: { label: string; value: string; error?: string; onChange: (text: string) => void }) {
  return (
    <label className="grid gap-1.5 text-sm">
      <span className="font-medium">{label}</span>
      <textarea
        spellCheck={false}
        className={cn(field, "min-h-[28rem] font-mono text-xs leading-relaxed", error && "border-amber")}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-invalid={Boolean(error)}
      />
      {error && (
        <span role="alert" className="text-xs text-amber">
          {error}
        </span>
      )}
    </label>
  );
}
