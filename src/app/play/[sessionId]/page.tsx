import type { Metadata } from "next";
import { Suspense } from "react";
import { GameClient } from "@/components/game/game-client";

export const metadata: Metadata = { title: "Investigation" };

// The game reads the signed-in player's state at request time (in the browser, through the API),
// so this page is a static shell and the client component behind Suspense does the rest.
export default function GamePage() {
  return (
    <Suspense
      fallback={
        <main className="grid flex-1 place-items-center">
          <p className="font-mono text-sm text-dim">Jacking in…</p>
        </main>
      }
    >
      <GameClient />
    </Suspense>
  );
}
