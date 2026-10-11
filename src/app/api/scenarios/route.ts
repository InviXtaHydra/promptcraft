import { NextResponse } from "next/server";
import { requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { listPlayableScenarios } from "@/server/engine/sessions";
import { route } from "@/server/http";

/** Published scenarios a player can start an investigation in. */
export const GET = route(async (request) => {
  await requireUser(prisma, request);
  return NextResponse.json({ scenarios: await listPlayableScenarios(prisma) });
});
