import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { buildGameView } from "@/server/engine/view";
import { route } from "@/server/http";

type Context = { params: Promise<{ sessionId: string }> };

/** The full state of one save game, for its owner. */
export const GET = route(async (request: NextRequest, { params }: Context) => {
  const user = await requireUser(prisma, request);
  const { sessionId } = await params;
  return NextResponse.json({ view: await buildGameView(prisma, sessionId, user.id, user.callsign) });
});
