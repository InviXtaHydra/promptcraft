import { NextResponse, type NextRequest } from "next/server";
import { agentDeps } from "@/server/agents/runtime";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { getConversation } from "@/server/engine/view";
import { route } from "@/server/http";

type Context = { params: Promise<{ sessionId: string; npcKey: string }> };

export const GET = route(async (request: NextRequest, { params }: Context) => {
  const user = await requireUser(prisma, request);
  const { sessionId, npcKey } = await params;
  const { brain } = agentDeps();
  return NextResponse.json({
    conversation: await getConversation(prisma, sessionId, user.id, npcKey, { id: brain.provider, model: brain.model, isSimulated: brain.isSimulated }),
  });
});
