import { createHash } from "node:crypto";
import type { Embedder } from "../ai/embeddings";
import { toVectorLiteral } from "../ai/embeddings";
import type { PrismaClient } from "../prisma-client";

/**
 * NPC long-term memory in PostgreSQL + pgvector.
 *
 * Scope: one player and one NPC (by key). Memories follow the player across investigations; the
 * current investigation ranks higher. Another player's or another NPC's memories are never part
 * of a query (both are WHERE conditions, not post-filters).
 */

export type RetrievedMemory = {
  id: string;
  content: string;
  kind: string;
  importance: number;
  similarity: number;
  recency: number;
  score: number;
  thisInvestigation: boolean;
  provenance: string;
  createdAt: string;
};

export const RETRIEVAL = {
  candidates: 24,
  topK: 5,
  charBudget: 1200,
  weights: { similarity: 0.55, importance: 0.25, recency: 0.15, thisInvestigation: 0.05 },
  recencyHalfLifeHours: 72,
  nearDuplicate: 0.92,
};

export const contentHashOf = (text: string) => createHash("sha256").update(text.trim().toLowerCase().replace(/\s+/g, " ")).digest("hex");

/** Combined relevance score in 0…1. Exported for unit tests. */
export function rankScore(similarity: number, importance: number, ageHours: number, thisInvestigation: boolean) {
  const recency = Math.pow(0.5, Math.max(0, ageHours) / RETRIEVAL.recencyHalfLifeHours);
  const w = RETRIEVAL.weights;
  const score = w.similarity * Math.max(0, similarity) + w.importance * (importance / 10) + w.recency * recency + (thisInvestigation ? w.thisInvestigation : 0);
  return { score, recency };
}

type Scope = { userId: string; npcKey: string; gameSessionId: string };

/** Gives memories written without a vector (engine story beats) their embedding, a few at a time. */
export async function embedMissing(prisma: PrismaClient, embedder: Embedder, scope: Scope, limit = 20, signal?: AbortSignal) {
  const missing = await prisma.$queryRaw<{ id: string; content: string }[]>`
    SELECT "id", "content" FROM "NPCMemory"
    WHERE "userId" = ${scope.userId} AND "npcKey" = ${scope.npcKey} AND ("embedding" IS NULL OR "embeddingModel" IS DISTINCT FROM ${embedder.model})
    ORDER BY "createdAt" DESC LIMIT ${limit}`;
  if (missing.length === 0) return 0;
  const vectors = await embedder.embed(
    missing.map((m) => m.content),
    "document",
    signal,
  );
  for (const [i, m] of missing.entries()) {
    await prisma.$executeRaw`UPDATE "NPCMemory" SET "embedding" = ${toVectorLiteral(vectors[i])}::vector, "embeddingModel" = ${embedder.model} WHERE "id" = ${m.id}`;
  }
  return missing.length;
}

/** Semantic recall: nearest neighbours by cosine distance, then re-ranked and trimmed to the budget. */
export async function retrieveMemories(prisma: PrismaClient, embedder: Embedder, scope: Scope, query: string, signal?: AbortSignal): Promise<RetrievedMemory[]> {
  await embedMissing(prisma, embedder, scope, 20, signal);
  const [vector] = await embedder.embed([query], "query", signal);
  const rows = await prisma.$queryRaw<
    { id: string; content: string; kind: string; importance: number; provenance: string; createdAt: Date; gameSessionId: string; similarity: number }[]
  >`
    SELECT "id", "content", "kind"::text AS "kind", "importance", "provenance", "createdAt", "gameSessionId",
           1 - ("embedding" <=> ${toVectorLiteral(vector)}::vector) AS "similarity"
    FROM "NPCMemory"
    WHERE "userId" = ${scope.userId} AND "npcKey" = ${scope.npcKey} AND "embeddingModel" = ${embedder.model} AND "embedding" IS NOT NULL
    ORDER BY "embedding" <=> ${toVectorLiteral(vector)}::vector
    LIMIT ${RETRIEVAL.candidates}`;

  const now = Date.now();
  const ranked = rows
    .map((r) => {
      const thisInvestigation = r.gameSessionId === scope.gameSessionId;
      const { score, recency } = rankScore(Number(r.similarity), r.importance, (now - r.createdAt.getTime()) / 3_600_000, thisInvestigation);
      return {
        id: r.id,
        content: r.content,
        kind: r.kind,
        importance: r.importance,
        similarity: Number(Number(r.similarity).toFixed(4)),
        recency: Number(recency.toFixed(4)),
        score: Number(score.toFixed(4)),
        thisInvestigation,
        provenance: r.provenance,
        createdAt: r.createdAt.toISOString(),
      };
    })
    .sort((a, b) => b.score - a.score);

  // Bounded context: top K, and never more than the character budget
  const chosen: RetrievedMemory[] = [];
  let chars = 0;
  for (const m of ranked) {
    if (chosen.length >= RETRIEVAL.topK || chars + m.content.length > RETRIEVAL.charBudget) break;
    chosen.push(m);
    chars += m.content.length;
  }
  if (chosen.length) await prisma.nPCMemory.updateMany({ where: { id: { in: chosen.map((m) => m.id) } }, data: { lastRecalledAt: new Date() } });
  return chosen;
}

export type MemoryCandidate = { content: string; kind: "EPISODIC" | "SEMANTIC" | "RELATIONSHIP" | "PROMISE" | "BETRAYAL" | "EVIDENCE" | "NEGOTIATION"; importance: number; source: string };
export type ConsolidationResult = { stored: { id: string; content: string }[]; skipped: { content: string; reason: string }[]; embedded: number };

const MAX_NEW_PER_TURN = 2;

/**
 * Stores what is worth remembering from this turn: validated (length, importance), deduplicated
 * (same text, or a near-identical vector), at most two new memories per turn. Engine memories
 * written during the turn only get their embeddings here.
 */
export async function consolidateMemories(
  prisma: PrismaClient,
  embedder: Embedder,
  scope: Scope & { npcId: string; runId: string },
  candidates: MemoryCandidate[],
  signal?: AbortSignal,
): Promise<ConsolidationResult> {
  const stored: ConsolidationResult["stored"] = [];
  const skipped: ConsolidationResult["skipped"] = [];

  for (const c of candidates) {
    const content = c.content.replace(/\s+/g, " ").trim();
    if (content.length < 8 || content.length > 300) {
      skipped.push({ content: content.slice(0, 80), reason: "length outside 8–300 characters" });
      continue;
    }
    if (stored.length >= MAX_NEW_PER_TURN) {
      skipped.push({ content, reason: `more than ${MAX_NEW_PER_TURN} new memories in one turn` });
      continue;
    }
    let vector: number[] | null = null;
    try {
      [vector] = await embedder.embed([content], "document", signal);
    } catch (error) {
      if (signal?.aborted) throw error;
      // Keep the memory without a vector; embedMissing adds it once the embedder is back
    }
    const near = vector === null ? [] : await prisma.$queryRaw<{ similarity: number }[]>`
      SELECT 1 - ("embedding" <=> ${toVectorLiteral(vector)}::vector) AS "similarity" FROM "NPCMemory"
      WHERE "userId" = ${scope.userId} AND "npcKey" = ${scope.npcKey} AND "embeddingModel" = ${embedder.model} AND "embedding" IS NOT NULL
      ORDER BY "embedding" <=> ${toVectorLiteral(vector)}::vector LIMIT 1`;
    if (near[0] && Number(near[0].similarity) >= RETRIEVAL.nearDuplicate) {
      skipped.push({ content, reason: `near-duplicate of an existing memory (similarity ${Number(near[0].similarity).toFixed(2)})` });
      continue;
    }
    const contentHash = contentHashOf(content);
    const created = await prisma.nPCMemory.createManyAndReturn({
      data: [
        {
          userId: scope.userId,
          npcKey: scope.npcKey,
          gameSessionId: scope.gameSessionId,
          npcId: scope.npcId,
          kind: c.kind,
          content,
          importance: Math.max(1, Math.min(10, Math.round(c.importance))),
          contentHash,
          provenance: `run:${scope.runId}:${c.source}`,
        },
      ],
      skipDuplicates: true,
    });
    if (created.length === 0) {
      skipped.push({ content, reason: "already remembered" });
      continue;
    }
    if (vector) await prisma.$executeRaw`UPDATE "NPCMemory" SET "embedding" = ${toVectorLiteral(vector)}::vector, "embeddingModel" = ${embedder.model} WHERE "id" = ${created[0].id}`;
    stored.push({ id: created[0].id, content });
  }
  let embedded = 0;
  try {
    embedded = await embedMissing(prisma, embedder, scope, 20, signal);
  } catch (error) {
    if (signal?.aborted) throw error;
  }
  return { stored, skipped, embedded };
}
