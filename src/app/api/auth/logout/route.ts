import { NextResponse } from "next/server";
import { assertSameOrigin, clearSessionCookie, destroyAuthSession } from "@/server/auth";
import { prisma } from "@/server/db";
import { route } from "@/server/http";

export const POST = route(async (request) => {
  assertSameOrigin(request);
  await destroyAuthSession(prisma, request);
  const response = NextResponse.json({ ok: true });
  clearSessionCookie(response);
  return response;
});
