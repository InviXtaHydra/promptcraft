import { NextResponse } from "next/server";
import { z } from "zod";
import { assertSameOrigin, createAuthSession, hashPassword, setSessionCookie } from "@/server/auth";
import { prisma } from "@/server/db";
import { GameError } from "@/server/errors";
import { clientIp, rateLimit, readJson, route } from "@/server/http";

const registerSchema = z.object({
  email: z.email("Enter a valid email address").max(254).transform((e) => e.toLowerCase()),
  password: z.string().min(10, "Use at least 10 characters").max(128),
  callsign: z
    .string()
    .trim()
    .min(3, "Callsign: at least 3 characters")
    .max(24, "Callsign: at most 24 characters")
    .regex(/^[A-Za-z0-9_-]+$/, "Callsign: letters, numbers, - and _ only"),
});

export const POST = route(async (request) => {
  assertSameOrigin(request);
  rateLimit(`register:${clientIp(request)}`, 10, 60 * 60 * 1000);
  const input = registerSchema.parse(await readJson(request));

  const taken = await prisma.user.findFirst({
    where: { OR: [{ email: input.email }, { profile: { callsign: { equals: input.callsign, mode: "insensitive" } } }] },
    include: { profile: true },
  });
  if (taken) {
    throw new GameError(409, "taken", taken.email === input.email ? "An account with this email already exists" : "That callsign is taken");
  }
  const user = await prisma.user.create({
    data: { email: input.email, passwordHash: await hashPassword(input.password), profile: { create: { callsign: input.callsign } } },
  });
  await prisma.auditLog.create({ data: { userId: user.id, action: "auth.register" } });

  const { token, expiresAt } = await createAuthSession(prisma, user.id);
  const response = NextResponse.json({ user: { email: user.email, callsign: input.callsign } }, { status: 201 });
  setSessionCookie(response, token, expiresAt);
  return response;
});
