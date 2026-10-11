import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireUser } from "@/server/auth";
import { assertCreator, forkScenario, listCreatorScenarios } from "@/server/creator";
import { prisma } from "@/server/db";
import { rateLimit, readJson, route } from "@/server/http";

export const GET = route(async (request) => {
  const user = await requireUser(prisma, request);
  assertCreator(user);
  return NextResponse.json(await listCreatorScenarios(prisma, user));
});

/** Start a draft by copying a published scenario. */
export const POST = route(async (request) => {
  assertSameOrigin(request);
  const user = await requireUser(prisma, request);
  assertCreator(user);
  rateLimit(`creator-fork:${user.id}`, 10, 60 * 60 * 1000);
  const { fromSlug } = z.object({ fromSlug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(64) }).parse(await readJson(request));
  return NextResponse.json(await forkScenario(prisma, user, fromSlug), { status: 201 });
});
