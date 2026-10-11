"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowLeft, GitFork, PenTool } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { api, ApiError } from "@/lib/api-client";
import { useAuthRedirect } from "../game/use-auth-redirect";

type Listing = {
  mine: { slug: string; title: string; draftId: string | null; published: number[]; previews: number }[];
  forkable: { slug: string; title: string }[];
};

export function CreatorHub() {
  const router = useRouter();
  const toLogin = useAuthRedirect();
  const [listing, setListing] = useState<Listing | null>(null);
  const [error, setError] = useState<{ status: number; message: string } | null>(null);
  const [forking, setForking] = useState<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();
    api<Listing>("/api/creator/scenarios", { signal: controller.signal })
      .then(setListing)
      .catch((e) => {
        if (controller.signal.aborted || toLogin(e)) return;
        setError(e instanceof ApiError ? { status: e.status, message: e.message } : { status: 500, message: "Couldn't load Creator Mode" });
      });
    return () => controller.abort();
  }, [toLogin]);

  async function fork(fromSlug: string) {
    setForking(fromSlug);
    try {
      const { draftId } = await api<{ draftId: string }>("/api/creator/scenarios", { method: "POST", body: { fromSlug } });
      router.push(`/creator/${draftId}`);
    } catch (e) {
      if (!toLogin(e)) toast.error(e instanceof ApiError ? e.message : "Couldn't create a draft");
      setForking(null);
    }
  }

  return (
    <main className="mx-auto w-full max-w-4xl flex-1 px-4 py-10 sm:px-6">
      <Link href="/play" className="inline-flex items-center gap-1 text-sm text-dim hover:text-text">
        <ArrowLeft className="size-4" aria-hidden="true" /> Your investigations
      </Link>
      <h1 className="mt-6 flex items-center gap-3 font-display text-4xl font-bold">
        <PenTool className="size-7 text-pink" aria-hidden="true" /> Creator Mode
      </h1>
      <p className="mt-2 max-w-2xl text-dim">
        Edit a copy of a scenario: its people, places, quests, evidence and how the city acts on its own. Drafts are checked before they can be previewed or
        published, and publishing creates a new version, so games already in progress keep the version they started on.
      </p>

      <section className="mt-10" aria-live="polite" aria-busy={!listing && !error}>
        {error?.status === 403 && (
          <div role="alert" className="frame p-6">
            <p className="font-display text-lg font-semibold">Creator Mode needs the creator role</p>
            <p className="mt-2 text-dim">{error.message}</p>
            <p className="mt-3 font-mono text-sm text-cyan">npm run user:role -- you@example.com CREATOR</p>
          </div>
        )}
        {error && error.status !== 403 && (
          <p role="alert" className="rounded border border-danger/40 bg-danger/10 px-4 py-3 text-danger">
            {error.message}
          </p>
        )}
        {!error && !listing && <div className="h-28 animate-pulse rounded-md border border-line bg-panel" />}
        {listing && (
          <div className="grid gap-10">
            <div>
              <h2 className="font-display text-xl font-semibold">Your scenarios</h2>
              {listing.mine.length === 0 && <p className="mt-2 text-dim">None yet. Start by copying a published scenario below.</p>}
              <ul className="mt-4 grid gap-3">
                {listing.mine.map((s) => (
                  <li key={s.slug} className="frame flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <p className="font-display font-semibold">{s.title}</p>
                      <p className="mt-1 text-sm text-dim">
                        {s.published.length ? `Published as version ${s.published.join(", ")}` : "Not published yet"}
                        {s.previews > 0 && `, ${s.previews} preview run${s.previews === 1 ? "" : "s"}`}
                      </p>
                    </div>
                    {s.draftId && (
                      <Link href={`/creator/${s.draftId}`} className="inline-flex h-9 items-center rounded-md border border-line px-4 text-sm hover:border-cyan/60">
                        Edit draft
                      </Link>
                    )}
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h2 className="font-display text-xl font-semibold">Start from a published scenario</h2>
              <ul className="mt-4 grid gap-3">
                {listing.forkable.map((s) => (
                  <li key={s.slug} className="frame flex items-center justify-between gap-3 p-4">
                    <p className="font-display font-semibold">{s.title}</p>
                    <Button variant="outline" onClick={() => fork(s.slug)} disabled={forking !== null}>
                      <GitFork aria-hidden="true" /> {forking === s.slug ? "Copying…" : "Copy into a draft"}
                    </Button>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        )}
      </section>
    </main>
  );
}
