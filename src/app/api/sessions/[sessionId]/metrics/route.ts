import { NextResponse, type NextRequest } from "next/server";
import { sessionMetrics } from "@/server/agents/metrics";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { route } from "@/server/http";

type Context = { params: Promise<{ sessionId: string }> };

/** Agent and simulation metrics for one save game (measured values and labelled estimates). */
export const GET = route(async (request: NextRequest, { params }: Context) => {
  const user = await requireUser(prisma, request);
  const { sessionId } = await params;
  return NextResponse.json({ metrics: await sessionMetrics(prisma, sessionId, user.id) });
});
