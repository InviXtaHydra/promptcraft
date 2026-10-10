import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Sign in" };

export default function LoginPage() {
  return (
    <>
      <h1 className="mt-6 font-display text-3xl font-bold">Welcome back, runner</h1>
      <p className="mt-2 text-sm text-dim">Your investigations are where you left them.</p>
      <Suspense>
        <AuthForm mode="login" />
      </Suspense>
    </>
  );
}
