import { z } from "zod";
import type { DialogueProvider } from "../dialogue/types";
import { GameError, notFound, rejected } from "../errors";
import type { PrismaClient } from "../prisma-client";
import type { AppliedOutcome } from "./apply";
import { commandSchema, handlers, type Command } from "./commands";
import { loadSessionContext } from "./context";
import { evaluateQuests } from "./quests";

export { commandSchema, type Command } from "./commands";

export const idempotencyKeySchema = z.string().min(8).max(80).regex(/^[A-Za-z0-9_-]+$/);

export type OutcomeSummary = { type: string; status: "applied" | "skipped"; text: string };

export type CommandResult = {
  type: Command["type"];
  turn: number;
  narration: string[];
  outcomes: OutcomeSummary[];
  npcKey?: string;
  agentRunId?: string;
  /** True when this idempotency key was seen before and the stored result is returned unchanged */
  replayed: boolean;
};

const summarize = (o: AppliedOutcome): OutcomeSummary =>
  o.status === "applied" ? { type: o.effect.type, status: "applied", text: o.text ?? o.effect.type } : { type: o.effect.type, status: "skipped", text: o.reason };

/**
 * Runs one player command against the authoritative state.
 *
 * - The save game must belong to `userId` (someone else's session is "not found").
 * - The session's WorldState row is locked (`FOR UPDATE`), so two requests for the same session
 *   run one after the other and can't both claim a reward.
 * - The idempotency key makes retries safe: a repeated key returns the stored result.
 * - Everything happens in one transaction: either the whole command applies, or nothing does.
 */
export async function executeCommand(
  prisma: PrismaClient,
  input: { userId: string; sessionId: string; command: unknown; idempotencyKey: unknown; provider: DialogueProvider },
): Promise<CommandResult> {
  const parsed = commandSchema.safeParse(input.command);
  if (!parsed.success) throw new GameError(422, "invalid_command", parsed.error.issues[0]?.message ?? "Invalid command");
  const key = idempotencyKeySchema.safeParse(input.idempotencyKey);
  if (!key.success) throw new GameError(422, "invalid_idempotency_key", "A valid idempotency key is required");
  const command = parsed.data;

  return prisma.$transaction(
    async (tx) => {
      const session = await tx.gameSession.findFirst({ where: { id: input.sessionId, userId: input.userId }, select: { id: true, status: true } });
      if (!session) throw notFound("Game session");
      if (session.status !== "ACTIVE") throw rejected("session_closed", "This investigation is closed");
      await tx.$queryRaw`SELECT 1 FROM "WorldState" WHERE "gameSessionId" = ${session.id} FOR UPDATE`;

      const previous = await tx.gameEvent.findUnique({
        where: { gameSessionId_idempotencyKey: { gameSessionId: session.id, idempotencyKey: key.data } },
      });
      if (previous) {
        if (previous.type !== command.type) throw rejected("idempotency_key_reused", "This idempotency key was already used for another action");
        return { ...(previous.result as Omit<CommandResult, "replayed">), replayed: true };
      }

      const ctx = await loadSessionContext(tx, session.id, input.userId);
      const handler = handlers[command.type] as (deps: Parameters<(typeof handlers)["travel"]>[0], cmd: Command) => ReturnType<(typeof handlers)["travel"]>;
      const handled = await handler({ tx, ctx, provider: input.provider }, command);
      const questOutcomes = await evaluateQuests(tx, ctx);

      const turn = ctx.state.turn + 1;
      await tx.worldState.update({ where: { gameSessionId: session.id }, data: { turn } });
      await tx.gameSession.update({ where: { id: session.id }, data: { lastPlayedAt: new Date() } });

      const result: Omit<CommandResult, "replayed"> = {
        type: command.type,
        turn,
        narration: handled.narration,
        outcomes: [...handled.outcomes, ...questOutcomes].map(summarize),
        ...(handled.npcKey ? { npcKey: handled.npcKey } : {}),
        ...(handled.agentRunId ? { agentRunId: handled.agentRunId } : {}),
      };
      await tx.gameEvent.create({
        data: { gameSessionId: session.id, type: command.type, actor: "PLAYER", idempotencyKey: key.data, turn, payload: command, result },
      });
      return { ...result, replayed: false };
    },
    { maxWait: 5_000, timeout: 15_000 },
  );
}
