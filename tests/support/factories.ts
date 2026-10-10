import { randomUUID } from "node:crypto";
import { readAiConfig } from "../../src/server/ai/config";
import { HashEmbedder } from "../../src/server/ai/embeddings";
import { MockBrain, type NpcBrain } from "../../src/server/agents/brain";
import { runNpcTurn, type TurnDeps } from "../../src/server/agents/npc-turn";
import type { TurnEvent } from "../../src/server/agents/trace";
import { mockDialogueProvider } from "../../src/server/dialogue/mock";
import { executeCommand, type Command } from "../../src/server/engine";
import { createGameSession } from "../../src/server/engine/sessions";
import { createPrismaClient, type PrismaClient } from "../../src/server/prisma-client";
import { testDatabaseUrl } from "./test-database";

export const testPrisma: PrismaClient = createPrismaClient(testDatabaseUrl());

/** Mock brain + deterministic embeddings: reproducible, no Ollama needed. */
export function testDeps(overrides: Partial<TurnDeps> = {}): TurnDeps {
  return {
    prisma: testPrisma,
    brain: new MockBrain(),
    embedder: new HashEmbedder(),
    config: readAiConfig({ DIALOGUE_PROVIDER: "mock", EMBEDDING_PROVIDER: "hash" }),
    ...overrides,
  };
}

let n = 0;
/** A player without a usable password (the engine tests don't sign in). */
export async function makePlayer(prisma = testPrisma) {
  const id = `${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return prisma.user.create({
    data: { email: `runner-${id}@test.invalid`, passwordHash: "!", profile: { create: { callsign: `runner_${id}` } } },
    include: { profile: true },
  });
}

export type TestCommand = Command | { type: "talk"; npcKey: string; message: string };

export async function newGame(options: { userId?: string; brain?: NpcBrain } = {}) {
  const user = options.userId ? await testPrisma.user.findUniqueOrThrow({ where: { id: options.userId }, include: { profile: true } }) : await makePlayer();
  const session = await createGameSession(testPrisma, user.id);
  const deps = testDeps(options.brain ? { brain: options.brain } : {});
  const talk = (npcKey: string, message: string, idempotencyKey: string = randomUUID(), opts: { signal?: AbortSignal; onEvent?: (e: TurnEvent) => void } = {}) =>
    runNpcTurn(deps, { userId: user.id, sessionId: session.id, npcKey, message, idempotencyKey }, opts);
  const run = async (command: TestCommand, idempotencyKey: string = randomUUID()) => {
    if (command.type === "talk") {
      const r = await talk(command.npcKey, command.message, idempotencyKey);
      return { type: "talk" as const, turn: r.turn, narration: [], outcomes: r.outcomes, npcKey: command.npcKey, agentRunId: r.runId, replayed: r.replayed };
    }
    return executeCommand(testPrisma, { userId: user.id, sessionId: session.id, command, idempotencyKey, reactions: mockDialogueProvider });
  };
  return { user, session, run, talk, deps };
}
