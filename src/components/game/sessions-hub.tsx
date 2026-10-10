"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, LogOut, MapPin, Plus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api-client";
import type { SessionSummary } from "@/lib/game-types";
import { useAuthRedirect } from "./use-auth-redirect";

const when = (iso: string) => new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(new Date(iso));

export function SessionsHub() {
  const router = useRouter();
  const toLogin = useAuthRedirect();
  const [me, setMe] = useState<{ callsign: string } | null>(null);
  const [sessions, setSessions] = useState<SessionSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    Promise.all([
      api<{ user: { callsign: string } }>("/api/auth/me", { signal: controller.signal }),
      api<{ sessions: SessionSummary[] }>("/api/sessions", { signal: controller.signal }),
    ])
      .then(([meRes, list]) => {
        setMe(meRes.user);
        setSessions(list.sessions);
      })
      .catch((e) => {
        if (controller.signal.aborted || toLogin(e)) return;
        setError(e instanceof ApiError ? e.message : "Couldn't load your investigations");
      });
    return () => controller.abort();
  }, [toLogin]);

  async function start() {
    setStarting(true);
    try {
      const { session } = await api<{ session: { id: string } }>("/api/sessions", { method: "POST", body: {} });
      router.push(`/play/${session.id}`);
    } catch (e) {
      if (!toLogin(e)) toast.error(e instanceof ApiError ? e.message : "Couldn't start an investigation");
      setStarting(false);
    }
  }

  async function signOut() {
    await api("/api/auth/logout", { method: "POST", body: {} }).catch(() => undefined);
    router.replace("/");
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6">
      <header className="flex items-center justify-between">
        <Link href="/" className="font-display text-lg font-bold tracking-wide">
          Prompt<span className="text-pink">Craft</span>
        </Link>
        <div className="flex items-center gap-3 text-sm">
          {me && <span className="font-mono text-cyan">{me.callsign}</span>}
          <Button variant="ghost" size="sm" onClick={signOut}>
            <LogOut aria-hidden="true" /> Sign out
          </Button>
        </div>
      </header>

      <div className="mt-14 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-display text-4xl font-bold">Your investigations</h1>
          <p className="mt-2 text-dim">Every investigation is its own save game. Progress is saved after every action.</p>
        </div>
        <Button onClick={start} disabled={starting} className="h-10 px-5 font-display font-semibold">
          <Plus aria-hidden="true" /> {starting ? "Opening a case…" : "New investigation"}
        </Button>
      </div>

      <section className="mt-10" aria-live="polite" aria-busy={sessions === null && !error}>
        {error && (
          <p role="alert" className="rounded border border-danger/40 bg-danger/10 px-4 py-3 text-danger">
            {error}
          </p>
        )}
        {!error && sessions === null && <div className="h-28 animate-pulse rounded-md border border-line bg-panel" />}
        {sessions?.length === 0 && (
          <div className="frame p-8 text-center">
            <p className="font-display text-xl font-semibold">No open cases yet</p>
            <p className="mx-auto mt-2 max-w-md text-dim">Start your first investigation: Balthazar is waiting in the Neon Slums, and his courier has been missing for three nights.</p>
          </div>
        )}
        <ul className="grid gap-4">
          {sessions?.map((s) => (
            <li key={s.id}>
              <Link href={`/play/${s.id}`} className="frame group flex flex-col gap-3 p-5 transition-colors hover:border-pink/50 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <p className="font-display text-lg font-semibold">{s.activeQuest ?? (s.questsCompleted > 0 ? "Chapter one complete" : "A new case")}</p>
                  <p className="mt-1 flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-dim">
                    <span className="inline-flex items-center gap-1">
                      <MapPin className="size-3.5" aria-hidden="true" /> {s.location}
                    </span>
                    <span className="font-mono text-amber">¤ {s.credits}</span>
                    <span>{s.questsCompleted} quests done</span>
                    <span>Last played {when(s.lastPlayedAt)}</span>
                  </p>
                </div>
                <span className="inline-flex items-center gap-1 text-sm text-cyan">
                  Continue <ArrowRight className="size-4 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
