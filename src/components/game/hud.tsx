"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "motion/react";
import { Coins, Gauge, MapPin, ShieldAlert } from "lucide-react";
import type { GameView } from "@/lib/game-types";
import { cn } from "@/lib/utils";

const ALERT_WORDS = ["Calm", "Watched", "Noticed", "Hunted", "Hot", "Lockdown"];

export function AlertMeter({ level }: { level: number }) {
  return (
    <div className="flex items-center gap-2" role="meter" aria-label="Security alert" aria-valuemin={0} aria-valuemax={5} aria-valuenow={level} aria-valuetext={`${level} of 5, ${ALERT_WORDS[level]}`}>
      <ShieldAlert className={cn("size-4", level >= 3 ? "text-danger" : level > 0 ? "text-amber" : "text-dim")} aria-hidden="true" />
      <div className="flex gap-0.5" aria-hidden="true">
        {Array.from({ length: 5 }, (_, i) => (
          <span key={i} className={cn("h-3 w-2.5 rounded-[2px] border", i < level ? (level >= 3 ? "border-danger bg-danger" : "border-amber bg-amber") : "border-line bg-ink")} />
        ))}
      </div>
      <span className={cn("hidden font-mono text-xs sm:inline", level >= 3 ? "text-danger" : "text-dim")}>{ALERT_WORDS[level]}</span>
    </div>
  );
}

export function Hud({ view }: { view: GameView }) {
  const reduce = useReducedMotion();
  return (
    <header className="sticky top-0 z-30 border-b border-line bg-ink/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-[1500px] items-center gap-4 px-3 sm:px-5">
        <Link href="/play" className="shrink-0 font-display text-base font-bold tracking-wide" aria-label="Back to your investigations">
          P<span className="text-pink">C</span>
          <span className="hidden sm:inline"> · Neon-Babylon</span>
        </Link>
        <div className="flex min-w-0 items-center gap-1.5 text-sm">
          <MapPin className="size-4 shrink-0" style={{ color: view.location.accent }} aria-hidden="true" />
          <span className="truncate font-medium">{view.location.name}</span>
          <span className="hidden truncate text-dim md:inline">· {view.location.district}</span>
        </div>
        <div className="ml-auto flex items-center gap-4 sm:gap-6">
          <motion.span
            key={view.world.credits}
            initial={reduce ? false : { scale: 1.25, color: "#ffffff" }}
            animate={{ scale: 1, color: "var(--amber)" }}
            transition={{ duration: 0.5 }}
            className="inline-flex items-center gap-1.5 font-mono text-sm"
            aria-label={`${view.world.credits} credits`}
          >
            <Coins className="size-4" aria-hidden="true" /> {view.world.credits}
          </motion.span>
          <AlertMeter level={view.world.alert} />
          <span className="hidden items-center gap-1.5 font-mono text-xs text-dim lg:inline-flex" aria-label={`Turn ${view.session.turn}`}>
            <Gauge className="size-3.5" aria-hidden="true" /> T{view.session.turn}
          </span>
          <span className="hidden font-mono text-xs text-cyan md:inline">{view.player.callsign}</span>
        </div>
      </div>
    </header>
  );
}
