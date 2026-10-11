import { NextResponse, type NextRequest } from "next/server";
import { assertSameOrigin, requireUser } from "@/server/auth";
import { assertCreator, publishDraft } from "@/server/creator";
import { prisma } from "@/server/db";
import { rateLimit, route } from "@/server/http";

type Context = { params: Promise<{ versionId: string }> };

/** Validate and publish the draft as a new, immutable version that players can start. */
export const POST = route(async (request: NextRequest, { params }: Context) => {
  assertSameOrigin(request);
  const user = await requireUser(prisma, request);
  assertCreator(user);
  rateLimit(`creator-publish:${user.id}`, 10, 60 * 60 * 1000);
  return NextResponse.json({ published: await publishDraft(prisma, user, (await params).versionId) }, { status: 201 });
});
