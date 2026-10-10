import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { assertSameOrigin, requireUser } from "@/server/auth";
import { prisma } from "@/server/db";
import { idempotencyKeySchema } from "@/server/engine";
import { assertSimulationControls, runSimulationTick, setPaused, simulationHistory } from "@/server/engine/simulation";
import { buildGameView } from "@/server/engine/view";
import { rateLimit, readJson, route } from "@/server/http";

type Context = { params: Promise<{ sessionId: string }> };

/** Simulation status and the last 50 ticks with every autonomous action. */
export const GET = route(async (request: NextRequest, { params }: Context) => {
  const user = await requireUser(prisma, request);
  const { sessionId } = await params;
  return NextResponse.json({ simulation: await simulationHistory(prisma, sessionId, user.id) });
});

const bodySchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("pause") }),
  z.object({ action: z.literal("resume") }),
  z.object({ action: z.literal("step"), idempotencyKey: idempotencyKeySchema }),
]);

/** Development controls: pause, resume, or run a single tick. */
export const POST = route(async (request: NextRequest, { params }: Context) => {
  assertSameOrigin(request);
  const user = await requireUser(prisma, request);
  assertSimulationControls(user.role);
  rateLimit(`simulation:${user.id}`, 30, 60 * 1000);
  const { sessionId } = await params;
  const body = bodySchema.parse(await readJson(request));
  let tick = null;
  if (body.action === "step") tick = await runSimulationTick(prisma, { sessionId, userId: user.id, trigger: "MANUAL", idempotencyKey: body.idempotencyKey });
  else await setPaused(prisma, sessionId, user.id, body.action === "pause");
  return NextResponse.json({ tick, simulation: await simulationHistory(prisma, sessionId, user.id), view: await buildGameView(prisma, sessionId, user.id, user.callsign) });
});
