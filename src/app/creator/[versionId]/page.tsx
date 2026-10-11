import type { Metadata } from "next";
import { Suspense } from "react";
import { DraftEditor } from "@/components/creator/draft-editor";

export const metadata: Metadata = { title: "Edit scenario" };

export default function DraftPage() {
  return (
    <Suspense
      fallback={
        <main className="grid flex-1 place-items-center">
          <p className="font-mono text-sm text-dim">Loading the draft…</p>
        </main>
      }
    >
      <DraftEditor />
    </Suspense>
  );
}
