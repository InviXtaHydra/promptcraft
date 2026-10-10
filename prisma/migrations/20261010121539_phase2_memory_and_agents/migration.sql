-- Phase 2: NPC memory scoped to player + NPC (recall across investigations), fixed embedding
-- dimension with an HNSW index, tool permissions per NPC, and more run metadata.

-- AgentRun metadata
ALTER TABLE "AgentRun" ADD COLUMN "estimatedCostUsd" DECIMAL(10,6),
ADD COLUMN "idempotencyKey" TEXT,
ADD COLUMN "modelCalls" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "retries" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "transitions" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX "AgentRun_gameSessionId_idempotencyKey_key" ON "AgentRun"("gameSessionId", "idempotencyKey");

-- Tool permissions, matching src/content/neon-babylon.ts for already-seeded scenario versions
ALTER TABLE "NPC" ADD COLUMN "allowedTools" TEXT[] DEFAULT ARRAY[]::TEXT[];
UPDATE "NPC" SET "allowedTools" = ARRAY['get_inventory','inspect_evidence','search_known_memories','update_quest','change_trust','record_world_event'] WHERE "key" = 'balthazar';
UPDATE "NPC" SET "allowedTools" = ARRAY['get_inventory','inspect_evidence','search_known_memories','change_trust','change_reputation','record_world_event'] WHERE "key" = 'kira';
UPDATE "NPC" SET "allowedTools" = ARRAY['search_known_memories','change_trust','trigger_security_alert','change_reputation','record_world_event'] WHERE "key" = 'vex-404';

-- Memory scope: add the player and the NPC key, backfilled from the existing rows
ALTER TABLE "NPCMemory" ADD COLUMN "npcKey" TEXT, ADD COLUMN "userId" TEXT;
UPDATE "NPCMemory" m SET "userId" = s."userId" FROM "GameSession" s WHERE s."id" = m."gameSessionId";
UPDATE "NPCMemory" m SET "npcKey" = n."key" FROM "NPC" n WHERE n."id" = m."npcId";
ALTER TABLE "NPCMemory" ALTER COLUMN "npcKey" SET NOT NULL, ALTER COLUMN "userId" SET NOT NULL;
ALTER TABLE "NPCMemory" ADD CONSTRAINT "NPCMemory_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

DROP INDEX "NPCMemory_gameSessionId_npcId_contentHash_key";
CREATE UNIQUE INDEX "NPCMemory_userId_npcKey_gameSessionId_contentHash_key" ON "NPCMemory"("userId", "npcKey", "gameSessionId", "contentHash");
CREATE INDEX "NPCMemory_userId_npcKey_createdAt_idx" ON "NPCMemory"("userId", "npcKey", "createdAt");

-- Fixed embedding dimension (nomic-embed-text and the test embedder both produce 768 values).
-- No memory had an embedding before this migration, so the type change loses nothing.
ALTER TABLE "NPCMemory" ALTER COLUMN "embedding" TYPE vector(768);
CREATE INDEX "NPCMemory_embedding_hnsw_idx" ON "NPCMemory" USING hnsw ("embedding" vector_cosine_ops);
