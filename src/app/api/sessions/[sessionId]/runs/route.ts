import { NextResponse, type NextRequest } from "next/server";
import { listRuns } from "@/server/agents/runs";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { route } from "@/server/http";

type Context = { params: Promise<{ sessionId: string }> };

/** Agent runs of one save game, newest first. Filters: ?npcKey=…&status=…&limit=… */
export const GET = route(async (request: NextRequest, { params }: Context) => {
  const user = await requireUser(prisma, request);
  const { sessionId } = await params;
  const q = request.nextUrl.searchParams;
  const runs = await listRuns(prisma, sessionId, user.id, {
    npcKey: q.get("npcKey") || undefined,
    status: (q.get("status") || undefined) as never,
    limit: q.get("limit") ?? undefined,
  });
  return NextResponse.json({ runs });
});
