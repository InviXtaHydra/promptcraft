import type { Metadata } from "next";
import { Suspense } from "react";
import { AuthForm } from "@/components/auth/auth-form";

export const metadata: Metadata = { title: "Create account" };

export default function RegisterPage() {
  return (
    <>
      <h1 className="mt-6 font-display text-3xl font-bold">Get a callsign</h1>
      <p className="mt-2 text-sm text-dim">One account keeps all your investigations and what the city remembers about you.</p>
      <Suspense>
        <AuthForm mode="register" />
      </Suspense>
    </>
  );
}
