"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { api, ApiError } from "@/lib/api-client";

/** Only allow redirects back into this app (no open redirect). */
function safeNext(next: string | null) {
  return next && next.startsWith("/") && !next.startsWith("//") ? next : "/play";
}

export function AuthForm({ mode }: { mode: "login" | "register" }) {
  const router = useRouter();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const register = mode === "register";

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError(null);
    try {
      await api(register ? "/api/auth/register" : "/api/auth/login", {
        method: "POST",
        body: Object.fromEntries(["email", "password", ...(register ? ["callsign"] : [])].map((k) => [k, String(form.get(k) ?? "")])),
      });
      router.replace(safeNext(params.get("next")));
      router.refresh();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : "Couldn't reach the server. Try again.");
      setBusy(false);
    }
  }

  return (
    <form onSubmit={onSubmit} className="mt-8 space-y-5" noValidate>
      {register && (
        <div className="space-y-2">
          <Label htmlFor="callsign">Callsign</Label>
          <Input id="callsign" name="callsign" autoComplete="nickname" required minLength={3} maxLength={24} placeholder="e.g. ghost_runner" />
          <p className="text-xs text-dim">What the city calls you. Letters, numbers, - and _.</p>
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="email">Email</Label>
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" name="password" type="password" autoComplete={register ? "new-password" : "current-password"} required minLength={register ? 10 : 1} />
        {register && <p className="text-xs text-dim">At least 10 characters.</p>}
      </div>
      {error && (
        <p role="alert" className="rounded border border-danger/40 bg-danger/10 px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" disabled={busy} className="h-10 w-full font-display text-base font-semibold">
        {busy ? "Connecting…" : register ? "Create account" : "Sign in"}
      </Button>
      <p className="text-center text-sm text-dim">
        {register ? "Already have an account? " : "New to the city? "}
        <Link href={register ? "/login" : "/register"} className="text-cyan underline-offset-4 hover:underline">
          {register ? "Sign in" : "Create an account"}
        </Link>
      </p>
    </form>
  );
}
