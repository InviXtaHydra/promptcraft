import { NextResponse, type NextRequest } from "next/server";
import { getRun } from "@/server/agents/runs";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { route } from "@/server/http";

type Context = { params: Promise<{ sessionId: string; runId: string }> };

/** One run with its steps, tool executions and messages. */
export const GET = route(async (request: NextRequest, { params }: Context) => {
  const user = await requireUser(prisma, request);
  const { sessionId, runId } = await params;
  return NextResponse.json({ run: await getRun(prisma, sessionId, user.id, runId) });
});
