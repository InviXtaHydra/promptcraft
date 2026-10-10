import Link from "next/link";
import { Skyline } from "@/components/landing/skyline";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="relative isolate grid flex-1 place-items-center px-4 py-16">
      <Skyline className="absolute inset-0 -z-20 h-full w-full opacity-60" />
      <div className="absolute inset-0 -z-10 bg-ink/70" aria-hidden="true" />
      <div className="frame w-full max-w-md p-8" style={{ ["--frame-accent" as string]: "var(--pink)" }}>
        <Link href="/" className="font-display text-lg font-bold tracking-wide">
          Prompt<span className="text-pink">Craft</span>
        </Link>
        {children}
      </div>
    </main>
  );
}
