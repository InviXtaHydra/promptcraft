import "server-only";
import { prisma } from "../db";
import { createAgentDeps } from ".";
import type { TurnDeps } from "./npc-turn";

let deps: TurnDeps | undefined;

/** The app's agent setup, created once per server process from the environment. */
export function agentDeps(): TurnDeps {
  deps ??= createAgentDeps(prisma);
  return deps;
}
