import "server-only";
import { createHash, randomBytes } from "node:crypto";
import bcrypt from "bcryptjs";
import type { NextRequest, NextResponse } from "next/server";
import type { UserRole } from "@/generated/prisma/client";
import { GameError } from "./errors";
import type { PrismaClient } from "./prisma-client";

/**
 * Cookie sessions: the browser holds a random 256-bit token in an httpOnly cookie; the database only
 * stores its SHA-256 hash, so a database leak doesn't leak working sessions.
 */
export const SESSION_COOKIE = "pc_session";
const SESSION_DAYS = 14;
const BCRYPT_COST = 12;

export type CurrentUser = { id: string; email: string; role: UserRole; callsign: string };

export const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

export async function hashPassword(password: string) {
  return bcrypt.hash(password, BCRYPT_COST);
}

export async function verifyPassword(password: string, hash: string) {
  return bcrypt.compare(password, hash);
}

// Compared against for unknown emails, so a login takes as long whether or not the account exists.
const DUMMY_HASH = bcrypt.hashSync("not-a-real-password", BCRYPT_COST);
export async function verifyPasswordOrDummy(password: string, hash: string | undefined) {
  const ok = await bcrypt.compare(password, hash ?? DUMMY_HASH);
  return Boolean(hash) && ok;
}

export async function createAuthSession(prisma: PrismaClient, userId: string) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000);
  await prisma.authSession.create({ data: { userId, tokenHash: hashToken(token), expiresAt } });
  return { token, expiresAt };
}

export function setSessionCookie(response: NextResponse, token: string, expiresAt: Date) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    expires: expiresAt,
  });
}

export function clearSessionCookie(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "lax", path: "/", maxAge: 0 });
}

export async function getCurrentUser(prisma: PrismaClient, request: NextRequest): Promise<CurrentUser | null> {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (!token || token.length > 100) return null;
  const session = await prisma.authSession.findUnique({
    where: { tokenHash: hashToken(token) },
    include: { user: { include: { profile: true } } },
  });
  if (!session || session.expiresAt <= new Date()) return null;
  // Touch at most once per hour, so reads don't turn into writes on every request
  if (Date.now() - session.lastSeenAt.getTime() > 60 * 60 * 1000) {
    await prisma.authSession.update({ where: { id: session.id }, data: { lastSeenAt: new Date() } });
  }
  const { user } = session;
  return { id: user.id, email: user.email, role: user.role, callsign: user.profile?.callsign ?? "Runner" };
}

export async function requireUser(prisma: PrismaClient, request: NextRequest): Promise<CurrentUser> {
  const user = await getCurrentUser(prisma, request);
  if (!user) throw new GameError(401, "unauthenticated", "Sign in to continue");
  return user;
}

export async function destroyAuthSession(prisma: PrismaClient, request: NextRequest) {
  const token = request.cookies.get(SESSION_COOKIE)?.value;
  if (token) await prisma.authSession.deleteMany({ where: { tokenHash: hashToken(token) } });
}

/**
 * CSRF protection for state-changing requests: the Origin header must be this app. Cookies are
 * SameSite=Lax as well; this closes the gap for same-site subdomains and older browsers.
 */
export function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const allowed = new Set([request.nextUrl.origin, ...(process.env.APP_ORIGIN ? [process.env.APP_ORIGIN] : [])]);
  if (!origin || !allowed.has(origin)) throw new GameError(403, "bad_origin", "Request blocked: unexpected origin");
}
