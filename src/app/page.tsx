import Link from "next/link";
import { ArrowRight, Brain, Database, ShieldCheck } from "lucide-react";
import { Skyline } from "@/components/landing/skyline";
import { neonBabylon } from "@/content/neon-babylon";

const npcs = neonBabylon.npcs;
const districts = neonBabylon.locations;

const pipeline = ["Validate", "Load state", "Recall memories", "Interpret", "Policy check", "Engine executes", "Reply"];

export default function LandingPage() {
  return (
    <main className="flex-1">
      {/* Hero */}
      <section className="relative isolate flex min-h-[100svh] flex-col overflow-hidden">
        <Skyline className="absolute inset-0 -z-20 h-full w-full" />
        <div
          className="motion-rain absolute inset-0 -z-10 opacity-40"
          style={{
            backgroundImage: "repeating-linear-gradient(105deg, transparent 0 22px, rgba(150,170,255,0.18) 22px 23px, transparent 23px 61px)",
            backgroundSize: "100% 100vh",
            animation: "rain 1.1s linear infinite",
          }}
          aria-hidden="true"
        />
        <div className="scanlines absolute inset-0 -z-10" aria-hidden="true" />
        {/* Keeps the intro readable over the lit windows */}
        <div className="absolute inset-y-0 left-0 -z-10 w-full bg-gradient-to-r from-ink/85 via-ink/55 to-transparent md:w-3/4" aria-hidden="true" />
        <div className="absolute inset-x-0 bottom-0 -z-10 h-48 bg-gradient-to-t from-ink to-transparent" aria-hidden="true" />

        <header className="mx-auto flex w-full max-w-6xl items-center justify-between px-4 py-5 sm:px-6">
          <span className="font-display text-lg font-bold tracking-wide">
            Prompt<span className="text-pink">Craft</span>
          </span>
          <nav className="flex items-center gap-4 text-sm">
            <Link href="/login" className="text-dim transition-colors hover:text-text">
              Sign in
            </Link>
            <Link href="/play" className="rounded-md border border-pink/60 px-3 py-1.5 font-medium text-text transition-colors hover:bg-pink/15">
              Play
            </Link>
          </nav>
        </header>

        <div className="mx-auto flex w-full max-w-6xl flex-1 flex-col justify-center px-4 pb-24 sm:px-6">
          <p className="font-mono text-sm text-cyan">Lower Babylon · 03:12 · raining</p>
          <h1 className="mt-4 font-display font-bold leading-[0.88] tracking-tight" style={{ fontSize: "clamp(3.2rem, 11vw, 9.5rem)" }}>
            <span className="glitch block" data-text="NEON-BABYLON">
              NEON-BABYLON
            </span>
            <span className="block font-mono text-amber" style={{ fontSize: "0.42em", letterSpacing: "0.3em" }}>
              2099
            </span>
          </h1>
          <p className="mt-6 max-w-xl text-lg text-text/80">
            A courier vanished with a memory shard nobody in the Slums should have. Follow the trail through a city where every NPC wants something, remembers
            what you did, and answers to a game engine that can&apos;t be talked out of its rules.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Link
              href="/play"
              className="group inline-flex items-center gap-2 rounded-md bg-pink px-6 py-3 font-display font-semibold text-primary-foreground shadow-[0_0_40px_-8px_var(--pink)] transition-transform hover:-translate-y-0.5"
            >
              Start the investigation
              <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
            </Link>
            <a href="#how" className="inline-flex items-center rounded-md border border-line bg-ink/60 px-6 py-3 font-medium backdrop-blur transition-colors hover:border-cyan/60">
              How it works
            </a>
          </div>
        </div>
      </section>

      {/* Characters */}
      <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6" aria-labelledby="people">
        <h2 id="people" className="font-display text-3xl font-bold sm:text-4xl">
          Three people who want something from you
        </h2>
        <p className="mt-3 max-w-2xl text-dim">Each has goals, secrets and a trust threshold. What they tell you depends on what you have done, not on how you phrase it.</p>
        <ul className="mt-10 grid gap-5 md:grid-cols-3">
          {npcs.map((npc) => (
            <li key={npc.key} className="frame p-6" style={{ ["--frame-accent" as string]: npc.accent }}>
              <p className="font-mono text-xs" style={{ color: npc.accent }}>
                {npc.title}
              </p>
              <h3 className="mt-2 font-display text-2xl font-bold">{npc.name}</h3>
              <p className="mt-3 text-sm text-text/75">{npc.shortBio}</p>
              <p className="mt-4 border-t border-line pt-4 text-sm text-dim">
                <span className="text-text/90">Wants: </span>
                {npc.persona.goals[0]}
              </p>
            </li>
          ))}
        </ul>
      </section>

      {/* How it works */}
      <section id="how" className="border-y border-line bg-panel/60" aria-labelledby="how-title">
        <div className="mx-auto grid max-w-6xl gap-12 px-4 py-24 sm:px-6 lg:grid-cols-2">
          <div>
            <h2 id="how-title" className="font-display text-3xl font-bold sm:text-4xl">
              The engine decides. The dialogue doesn&apos;t.
            </h2>
            <p className="mt-4 text-dim">
              NPCs can only <em>propose</em> actions. Every credit, item, clue and alert level is changed by a server-side game engine that checks permissions,
              preconditions and limits, in one database transaction.
            </p>
            <ul className="mt-8 space-y-5">
              <li className="flex gap-3">
                <ShieldCheck className="mt-0.5 size-5 shrink-0 text-cyan" aria-hidden="true" />
                <span>
                  <strong className="font-medium">Authoritative state.</strong> <span className="text-dim">The browser sends intent, never state. Rewards are granted once, even if you click twice.</span>
                </span>
              </li>
              <li className="flex gap-3">
                <Database className="mt-0.5 size-5 shrink-0 text-amber" aria-hidden="true" />
                <span>
                  <strong className="font-medium">Persistent memory.</strong> <span className="text-dim">NPCs keep what happened in PostgreSQL, ready for semantic recall with pgvector.</span>
                </span>
              </li>
              <li className="flex gap-3">
                <Brain className="mt-0.5 size-5 shrink-0 text-pink" aria-hidden="true" />
                <span>
                  <strong className="font-medium">Honest about AI.</strong>{" "}
                  <span className="text-dim">Right now the NPCs speak from a deterministic script, and every line says so. Language models arrive in the next phase.</span>
                </span>
              </li>
            </ul>
          </div>
          <div className="frame self-center p-6" aria-label="What happens on every NPC turn">
            <p className="font-mono text-xs text-cyan">Every NPC turn</p>
            <ol className="mt-5 space-y-2">
              {pipeline.map((step, i) => (
                <li key={step} className="flex items-center gap-3 rounded border border-line bg-ink/60 px-3 py-2 font-mono text-sm">
                  <span className="w-5 text-right text-dim">{i + 1}</span>
                  <span className={step === "Policy check" || step === "Engine executes" ? "text-amber" : ""}>{step}</span>
                </li>
              ))}
            </ol>
            <p className="mt-4 text-xs text-dim">Recorded as a trace for each turn: what was proposed, what the policy rejected, what changed.</p>
          </div>
        </div>
      </section>

      {/* Districts */}
      <section className="mx-auto max-w-6xl px-4 py-24 sm:px-6" aria-labelledby="districts">
        <h2 id="districts" className="font-display text-3xl font-bold sm:text-4xl">
          From the Slums to the Spire
        </h2>
        <ul className="mt-10 grid gap-5 md:grid-cols-3">
          {districts.map((d) => (
            <li key={d.key} className="overflow-hidden rounded-md border border-line bg-panel">
              <div className="h-1.5" style={{ background: d.accent }} aria-hidden="true" />
              <div className="p-6">
                <p className="text-sm text-dim">{d.district}</p>
                <h3 className="mt-1 font-display text-xl font-bold">{d.name}</h3>
                <p className="mt-3 text-sm text-text/75">{d.description}</p>
              </div>
            </li>
          ))}
        </ul>
        <div className="mt-14 flex justify-center">
          <Link href="/play" className="inline-flex items-center gap-2 rounded-md bg-pink px-6 py-3 font-display font-semibold text-primary-foreground transition-transform hover:-translate-y-0.5">
            Jack in <ArrowRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </section>

      <footer className="border-t border-line py-8 text-center text-sm text-dim">
        PromptCraft: Neon-Babylon 2099 · Phase 1 · NPC dialogue is simulated by a deterministic script
      </footer>
    </main>
  );
}
