import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { generateItemReaction } from "@/server/agents/reaction";
import { agentDeps } from "@/server/agents/runtime";
import { assertSameOrigin, requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { mockDialogueProvider } from "@/server/dialogue/mock";
import { executeCommand } from "@/server/engine";
import { buildGameView } from "@/server/engine/view";
import { rateLimit, readJson, route } from "@/server/http";

type Context = { params: Promise<{ sessionId: string }> };
const bodySchema = z.object({ command: z.unknown(), idempotencyKey: z.unknown() });

/**
 * Run one game command (travel, investigate, give, buy). Talking to NPCs goes through
 * /api/sessions/{id}/talk, which streams the agent's turn.
 */
export const POST = route(async (request: NextRequest, { params }: Context) => {
  assertSameOrigin(request);
  const user = await requireUser(prisma, request);
  rateLimit(`commands:${user.id}`, 60, 60 * 1000);
  const { sessionId } = await params;
  const body = bodySchema.parse(await readJson(request));
  const deps = agentDeps();
  // With the mock, the NPC's reaction to an item is scripted inside the transaction; with a model
  // it is generated afterwards (and labelled as such), so the model never runs inside a transaction.
  const scripted = deps.brain.isSimulated;
  const result = await executeCommand(prisma, {
    userId: user.id,
    sessionId,
    command: body.command,
    idempotencyKey: body.idempotencyKey,
    reactions: scripted ? mockDialogueProvider : null,
  });
  let reactionError: string | undefined;
  if (!scripted && result.type === "give" && result.npcKey && !result.replayed) {
    const reaction = await generateItemReaction(deps, {
      userId: user.id,
      sessionId,
      npcKey: result.npcKey,
      itemKey: String((body.command as { itemKey?: unknown }).itemKey ?? ""),
      outcomes: result.outcomes,
    });
    if (!reaction.ok) reactionError = reaction.message;
  }
  return NextResponse.json({ result: { ...result, ...(reactionError ? { reactionError } : {}) }, view: await buildGameView(prisma, sessionId, user.id, user.callsign) });
});
