import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, requireUser } from "@/server/auth";
import { assertCreator, previewDraft } from "@/server/creator";
import { prisma } from "@/server/db";
import { rateLimit, route } from "@/server/http";

type Context = { params: Promise<{ versionId: string }> };

/** Validate and start an isolated test run of the draft. */
export const POST = route(async (request: NextRequest, { params }: Context) => {
  assertSameOrigin(request);
  const user = await requireUser(prisma, request);
  assertCreator(user);
  rateLimit(`creator-preview:${user.id}`, 20, 60 * 60 * 1000);
  return NextResponse.json(await previewDraft(prisma, user, (await params).versionId), { status: 201 });
});
