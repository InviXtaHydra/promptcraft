import { randomUUID } from "node:crypto";
import { mockDialogueProvider } from "../../src/server/dialogue/mock";
import { executeCommand, type Command } from "../../src/server/engine";
import { createGameSession } from "../../src/server/engine/sessions";
import { createPrismaClient, type PrismaClient } from "../../src/server/prisma-client";
import { testDatabaseUrl } from "./test-database";

export const testPrisma: PrismaClient = createPrismaClient(testDatabaseUrl());

let n = 0;
/** A player without a usable password (the engine tests don't sign in). */
export async function makePlayer(prisma = testPrisma) {
  const id = `${Date.now().toString(36)}${(n++).toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  return prisma.user.create({
    data: { email: `runner-${id}@test.invalid`, passwordHash: "!", profile: { create: { callsign: `runner_${id}` } } },
    include: { profile: true },
  });
}

export async function newGame(prisma = testPrisma) {
  const user = await makePlayer(prisma);
  const session = await createGameSession(prisma, user.id);
  const run = (command: Command, idempotencyKey: string = randomUUID()) =>
    executeCommand(prisma, { userId: user.id, sessionId: session.id, command, idempotencyKey, provider: mockDialogueProvider });
  return { user, session, run };
}
