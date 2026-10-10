import { NextResponse } from "next/server";
import { aiStatus } from "@/server/agents";
import { agentDeps } from "@/server/agents/runtime";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { route } from "@/server/http";

/** Which AI the NPCs use and whether it's ready (Ollama reachable, models installed). */
export const GET = route(async (request) => {
  await requireUser(prisma, request);
  return NextResponse.json({ status: await aiStatus(agentDeps().config) });
});
