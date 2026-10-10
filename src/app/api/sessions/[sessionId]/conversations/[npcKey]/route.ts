import { NextResponse, type NextRequest } from "next/server";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { getDialogueProvider } from "@/server/dialogue";
import { getConversation } from "@/server/engine/view";
import { route } from "@/server/http";

type Context = { params: Promise<{ sessionId: string; npcKey: string }> };

export const GET = route(async (request: NextRequest, { params }: Context) => {
  const user = await requireUser(prisma, request);
  const { sessionId, npcKey } = await params;
  return NextResponse.json({ conversation: await getConversation(prisma, sessionId, user.id, npcKey, getDialogueProvider()) });
});
