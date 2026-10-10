import { NextResponse, type NextRequest } from "next/server";
import { replayPolicy } from "@/server/agents/metrics";
import { assertSameOrigin, requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { rateLimit, route } from "@/server/http";

type Context = { params: Promise<{ sessionId: string; runId: string }> };

/** Dry-run replay of a recorded turn's tool calls against today's rules. Writes nothing. */
export const POST = route(async (request: NextRequest, { params }: Context) => {
  assertSameOrigin(request);
  const user = await requireUser(prisma, request);
  rateLimit(`replay:${user.id}`, 30, 60 * 1000);
  const { sessionId, runId } = await params;
  return NextResponse.json({ replay: await replayPolicy(prisma, sessionId, user.id, runId) });
});
