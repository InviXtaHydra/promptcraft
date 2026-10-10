import type { NextRequest } from "next/server";
import { z } from "zod";
import { runNpcTurn, type TurnEvent } from "@/server/agents";
import { agentDeps } from "@/server/agents/runtime";
import { assertSameOrigin, requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { GameError } from "@/server/errors";
import { buildGameView } from "@/server/engine/view";
import { rateLimit, readJson, route } from "@/server/http";

type Context = { params: Promise<{ sessionId: string }> };
const bodySchema = z.object({ npcKey: z.string(), message: z.string(), idempotencyKey: z.string() });

/**
 * One conversation turn, streamed as Server-Sent Events: run_started, node, memories, tool,
 * outcome, delta (reply text), usage, then view (the new game state) and done — or error.
 * Closing the connection cancels the turn.
 */
export const POST = route(async (request: NextRequest, { params }: Context) => {
  assertSameOrigin(request);
  const user = await requireUser(prisma, request);
  rateLimit(`talk:${user.id}`, 20, 60 * 1000);
  const { sessionId } = await params;
  const body = bodySchema.parse(await readJson(request));
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      let open = true;
      const send = (event: TurnEvent | { type: "view"; view: unknown }) => {
        if (!open) return;
        try {
          controller.enqueue(encoder.encode(`event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`));
        } catch {
          open = false;
        }
      };
      try {
        await runNpcTurn(agentDeps(), { userId: user.id, sessionId, ...body }, { signal: request.signal, onEvent: send });
        send({ type: "view", view: await buildGameView(prisma, sessionId, user.id, user.callsign) });
      } catch (error) {
        // Errors inside a run were already sent as an "error" event; this covers requests that never started one
        if (error instanceof GameError && !String(error.code).startsWith("ai_") && error.code !== "turn_failed") send({ type: "error", code: error.code, message: error.message });
      } finally {
        open = false;
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: { "content-type": "text/event-stream; charset=utf-8", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" },
  });
});
