import "server-only";
import { NextResponse, type NextRequest } from "next/server";
import { ZodError } from "zod";
import { GameError } from "./errors";

/**
 * Wraps a route handler: GameErrors become JSON with their status, validation errors become 422,
 * anything else is logged (without request bodies, cookies or passwords) and answered with a 500.
 */
export function route<C>(handler: (request: NextRequest, context: C) => Promise<Response>) {
  return async (request: NextRequest, context: C) => {
    try {
      return await handler(request, context);
    } catch (error) {
      if (error instanceof GameError) return NextResponse.json({ error: { code: error.code, message: error.message } }, { status: error.status });
      if (error instanceof ZodError) {
        return NextResponse.json({ error: { code: "invalid_input", message: error.issues[0]?.message ?? "Invalid input" } }, { status: 422 });
      }
      console.error(JSON.stringify({ level: "error", route: request.nextUrl.pathname, method: request.method, error: error instanceof Error ? error.message : String(error) }));
      return NextResponse.json({ error: { code: "internal", message: "Something went wrong on our side. Try again." } }, { status: 500 });
    }
  };
}

/** Reads a JSON body; a missing or non-JSON body is a 400 instead of a crash. */
export async function readJson(request: NextRequest): Promise<unknown> {
  if (!request.headers.get("content-type")?.includes("application/json")) throw new GameError(400, "bad_request", "Send JSON");
  try {
    return await request.json();
  } catch {
    throw new GameError(400, "bad_request", "The body is not valid JSON");
  }
}

/**
 * Fixed-window rate limit per key, in memory (per server process). Enough for one instance; a shared
 * store (e.g. Redis) is needed when running several instances. See docs/ARCHITECTURE.md.
 */
const windows = new Map<string, { start: number; count: number }>();
export function rateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();
  const w = windows.get(key);
  if (!w || now - w.start >= windowMs) {
    windows.set(key, { start: now, count: 1 });
    if (windows.size > 10_000) for (const [k, v] of windows) if (now - v.start >= windowMs) windows.delete(k);
    return;
  }
  w.count++;
  if (w.count > limit) throw new GameError(429, "rate_limited", "Too many requests. Wait a moment and try again.");
}

export function clientIp(request: NextRequest) {
  return request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
}
