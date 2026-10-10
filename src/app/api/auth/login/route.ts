import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, createAuthSession, setSessionCookie, verifyPasswordOrDummy } from "@/server/auth";
import { prisma } from "@/server/db";
import { GameError } from "@/server/errors";
import { clientIp, rateLimit, readJson, route } from "@/server/http";

const loginSchema = z.object({ email: z.string().max(254).transform((e) => e.trim().toLowerCase()), password: z.string().max(128) });

export const POST = route(async (request) => {
  assertSameOrigin(request);
  const input = loginSchema.parse(await readJson(request));
  rateLimit(`login:${input.email}`, 8, 15 * 60 * 1000);
  rateLimit(`login-ip:${clientIp(request)}`, 30, 15 * 60 * 1000);

  const user = await prisma.user.findUnique({ where: { email: input.email }, include: { profile: true } });
  const ok = await verifyPasswordOrDummy(input.password, user?.passwordHash);
  if (!user || !ok) {
    await prisma.auditLog.create({ data: { userId: user?.id ?? null, action: "auth.login_failed" } });
    throw new GameError(401, "invalid_credentials", "Wrong email or password");
  }
  await prisma.auditLog.create({ data: { userId: user.id, action: "auth.login" } });

  const { token, expiresAt } = await createAuthSession(prisma, user.id);
  const response = NextResponse.json({ user: { email: user.email, callsign: user.profile?.callsign ?? "Runner" } });
  setSessionCookie(response, token, expiresAt);
  return response;
});
