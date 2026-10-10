"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";
import { BookOpen, Building2, MessagesSquare } from "lucide-react";
import { toast } from "sonner";
import { api, ApiError, newActionKey } from "@/lib/api-client";
import type { CommandResponse, ConversationView, GameView } from "@/lib/game-types";
import { cn } from "@/lib/utils";
import { ChatTerminal } from "./chat-terminal";
import { CityPanel } from "./city-panel";
import { Hud } from "./hud";
import { EventFeed, Journal } from "./journal";
import { useAuthRedirect } from "./use-auth-redirect";

/** What the player can ask for. The server validates all of it again (src/server/engine/commands.ts). */
export type Command =
  | { type: "travel"; locationKey: string }
  | { type: "investigate" }
  | { type: "talk"; npcKey: string; message: string }
  | { type: "give"; npcKey: string; itemKey: string }
  | { type: "buy"; npcKey: string; itemKey: string };

type Tab = "city" | "talk" | "journal";

export function GameClient() {
  const { sessionId } = useParams<{ sessionId: string }>();
  const toLogin = useAuthRedirect();
  const [view, setView] = useState<GameView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [chosenNpc, setChosenNpc] = useState<string | null>(null);
  const [conversation, setConversation] = useState<ConversationView | null>(null);
  const [busy, setBusy] = useState(false);
  const [narration, setNarration] = useState<string[]>([]);
  const [tab, setTab] = useState<Tab>("city");

  useEffect(() => {
    const controller = new AbortController();
    api<{ view: GameView }>(`/api/sessions/${sessionId}`, { signal: controller.signal })
      .then((res) => setView(res.view))
      .catch((e) => {
        if (controller.signal.aborted || toLogin(e)) return;
        setLoadError(e instanceof ApiError && e.status === 404 ? "This investigation doesn't exist, or it isn't yours." : "Couldn't load the investigation.");
      });
    return () => controller.abort();
  }, [sessionId, toLogin]);

  // The selected NPC must be reachable from the current location; otherwise fall back to the first one
  const npc = useMemo(() => view?.npcsHere.find((n) => n.key === chosenNpc) ?? view?.npcsHere[0] ?? null, [view, chosenNpc]);
  const npcKey = npc?.key ?? null;
  const turn = view?.session.turn;

  useEffect(() => {
    if (!npcKey) return;
    const controller = new AbortController();
    api<{ conversation: ConversationView }>(`/api/sessions/${sessionId}/conversations/${npcKey}`, { signal: controller.signal })
      .then((res) => setConversation(res.conversation))
      .catch((e) => {
        if (!controller.signal.aborted) toLogin(e);
      });
    return () => controller.abort();
  }, [sessionId, npcKey, turn, toLogin]);

  const run = useCallback(
    async (command: Command): Promise<boolean> => {
      setBusy(true);
      const key = newActionKey();
      const send = () => api<CommandResponse>(`/api/sessions/${sessionId}/commands`, { method: "POST", body: { command, idempotencyKey: key } });
      try {
        let res: CommandResponse;
        try {
          res = await send();
        } catch (e) {
          // A dropped connection: retry once with the same key, so the action can't happen twice
          if (e instanceof ApiError) throw e;
          res = await send();
        }
        setView(res.view);
        if (command.type !== "talk") setNarration(res.result.narration);
        for (const o of res.result.outcomes) if (o.status === "applied") toast(o.text);
        if (command.type === "talk" || command.type === "give") setTab("talk");
        return true;
      } catch (e) {
        if (!toLogin(e)) toast.error(e instanceof ApiError ? e.message : "Connection lost. Your last action may not have gone through.");
        return false;
      } finally {
        setBusy(false);
      }
    },
    [sessionId, toLogin],
  );

  if (loadError) {
    return (
      <main className="grid flex-1 place-items-center px-4">
        <div className="frame max-w-md p-8 text-center">
          <p role="alert" className="font-display text-xl font-semibold">
            {loadError}
          </p>
          <Link href="/play" className="mt-4 inline-block text-cyan underline-offset-4 hover:underline">
            Back to your investigations
          </Link>
        </div>
      </main>
    );
  }

  if (!view) {
    return (
      <main className="grid flex-1 place-items-center" aria-busy="true">
        <p className="font-mono text-sm text-dim" role="status">
          Jacking in…
        </p>
      </main>
    );
  }

  const tabs: { id: Tab; label: string; icon: typeof Building2 }[] = [
    { id: "city", label: "City", icon: Building2 },
    { id: "talk", label: "Talk", icon: MessagesSquare },
    { id: "journal", label: "Journal", icon: BookOpen },
  ];

  return (
    <div className="flex min-h-svh flex-col">
      <Hud view={view} />
      <main className="mx-auto grid w-full max-w-[1500px] flex-1 gap-4 px-3 pt-4 pb-24 sm:px-5 lg:grid-cols-[320px_minmax(0,1fr)_360px] lg:pb-6">
        <div className={cn(tab === "city" ? "block" : "hidden", "lg:block")}>
          <CityPanel
            view={view}
            selectedNpc={npcKey}
            onSelectNpc={(key) => {
              setChosenNpc(key);
              setTab("talk");
            }}
            run={(c) => void run(c)}
            busy={busy}
            narration={narration}
          />
        </div>
        <div className={cn(tab === "talk" ? "block" : "hidden", "lg:block")}>
          <ChatTerminal npc={npc} conversation={conversation?.npc.key === npcKey ? conversation : null} credits={view.world.credits} run={run} busy={busy} />
        </div>
        <div className={cn(tab === "journal" ? "flex" : "hidden", "flex-col gap-4 lg:flex")}>
          <Journal view={view} />
          <EventFeed view={view} />
        </div>
      </main>

      {/* Mobile navigation */}
      <nav className="fixed inset-x-0 bottom-0 z-30 grid grid-cols-3 border-t border-line bg-ink/95 backdrop-blur lg:hidden" aria-label="Game sections">
        {tabs.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            type="button"
            onClick={() => setTab(id)}
            aria-current={tab === id ? "page" : undefined}
            className={cn("flex flex-col items-center gap-1 py-2.5 text-xs", tab === id ? "text-pink" : "text-dim")}
          >
            <Icon className="size-5" aria-hidden="true" />
            {label}
          </button>
        ))}
      </nav>
    </div>
  );
}
