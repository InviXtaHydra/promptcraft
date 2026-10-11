import { NextResponse } from "next/server";
import { assertSameOrigin, requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { createGameSession, listGameSessions } from "@/server/engine/sessions";
import { z } from "zod";
import { rateLimit, readJson, route } from "@/server/http";

export const GET = route(async (request) => {
  const user = await requireUser(prisma, request);
  return NextResponse.json({ sessions: await listGameSessions(prisma, user.id) });
});

/** Start a new investigation. */
export const POST = route(async (request) => {
  assertSameOrigin(request);
  const user = await requireUser(prisma, request);
  rateLimit(`new-session:${user.id}`, 10, 60 * 60 * 1000);
  const body = z.object({ scenarioSlug: z.string().regex(/^[a-z0-9][a-z0-9-]*$/).max(64).optional() }).parse(await readJson(request).catch(() => ({})));
  const session = await createGameSession(prisma, user.id, { scenarioSlug: body.scenarioSlug });
  return NextResponse.json({ session: { id: session.id } }, { status: 201 });
});
