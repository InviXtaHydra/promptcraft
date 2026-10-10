import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { getDialogueProvider } from "@/server/dialogue";
import { executeCommand } from "@/server/engine";
import { buildGameView } from "@/server/engine/view";
import { rateLimit, readJson, route } from "@/server/http";

type Context = { params: Promise<{ sessionId: string }> };
const bodySchema = z.object({ command: z.unknown(), idempotencyKey: z.unknown() });

/**
 * Run one game command. Body: { command: { type, ... }, idempotencyKey }. The engine validates the
 * command and the session's ownership; the response has the result and the new state.
 */
export const POST = route(async (request: NextRequest, { params }: Context) => {
  assertSameOrigin(request);
  const user = await requireUser(prisma, request);
  rateLimit(`commands:${user.id}`, 60, 60 * 1000);
  const { sessionId } = await params;
  const body = bodySchema.parse(await readJson(request));
  const result = await executeCommand(prisma, {
    userId: user.id,
    sessionId,
    command: body.command,
    idempotencyKey: body.idempotencyKey,
    provider: getDialogueProvider(),
  });
  return NextResponse.json({ result, view: await buildGameView(prisma, sessionId, user.id, user.callsign) });
});
