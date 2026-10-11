import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireUser } from "@/server/auth";
import { assertCreator, getDraft, saveDraft } from "@/server/creator";
import { prisma } from "@/server/db";
import { rateLimit, readJson, route } from "@/server/http";

type Context = { params: Promise<{ versionId: string }> };

export const GET = route(async (request: NextRequest, { params }: Context) => {
  const user = await requireUser(prisma, request);
  assertCreator(user);
  return NextResponse.json({ draft: await getDraft(prisma, user, (await params).versionId) });
});

/** Save the draft (it may be invalid while you work) and get the validation result back. */
export const PUT = route(async (request: NextRequest, { params }: Context) => {
  assertSameOrigin(request);
  const user = await requireUser(prisma, request);
  assertCreator(user);
  rateLimit(`creator-save:${user.id}`, 120, 60 * 1000);
  const { definition } = z.object({ definition: z.unknown() }).parse(await readJson(request));
  return NextResponse.json({ validation: await saveDraft(prisma, user, (await params).versionId, definition) });
});
