-- Phase 3: investigation content (suspects, evidence links, endings, choices, NPC intentions),
-- simulation state and ticks, hypotheses and case files, Creator Mode definitions and previews.
-- (The HNSW index on NPCMemory.embedding is kept: Prisma can't express it, see AGENTS.md.)

-- CreateEnum
CREATE TYPE "EvidenceRelation" AS ENUM ('SUPPORTS', 'CONTRADICTS', 'LEADS_TO', 'IMPLICATES', 'EXONERATES');

-- CreateEnum
CREATE TYPE "TickTrigger" AS ENUM ('TURN', 'MANUAL', 'SCHEDULE');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ObjectiveKind" ADD VALUE 'TRUST_AT_LEAST';
ALTER TYPE "ObjectiveKind" ADD VALUE 'CLOSE_CASE';

-- AlterEnum
ALTER TYPE "ScenarioVersionStatus" ADD VALUE 'PREVIEW';

-- DropIndex

-- AlterTable
ALTER TABLE "GameSession" ADD COLUMN     "endedAt" TIMESTAMP(3),
ADD COLUMN     "endingKey" TEXT,
ADD COLUMN     "isPreview" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "Location" ADD COLUMN     "unlockItemKeys" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- AlterTable
ALTER TABLE "QuestObjective" ADD COLUMN     "threshold" INTEGER;

-- AlterTable
ALTER TABLE "ScenarioVersion" ADD COLUMN     "definition" JSONB,
ADD COLUMN     "simulationEveryTurns" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN     "simulationMaxActions" INTEGER NOT NULL DEFAULT 2;

-- CreateTable
CREATE TABLE "Suspect" (
    "id" TEXT NOT NULL,
    "scenarioVersionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "motive" TEXT NOT NULL,
    "npcKey" TEXT,

    CONSTRAINT "Suspect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "EvidenceLink" (
    "id" TEXT NOT NULL,
    "scenarioVersionId" TEXT NOT NULL,
    "fromEvidenceKey" TEXT NOT NULL,
    "toEvidenceKey" TEXT,
    "toSuspectKey" TEXT,
    "relation" "EvidenceRelation" NOT NULL,
    "note" TEXT NOT NULL,

    CONSTRAINT "EvidenceLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Ending" (
    "id" TEXT NOT NULL,
    "scenarioVersionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "priority" INTEGER NOT NULL,
    "conditions" JSONB NOT NULL,
    "effects" JSONB NOT NULL DEFAULT '[]',
    "tone" TEXT NOT NULL DEFAULT 'neutral',

    CONSTRAINT "Ending_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Choice" (
    "id" TEXT NOT NULL,
    "scenarioVersionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "prompt" TEXT NOT NULL,
    "offeredByNpcKey" TEXT,
    "options" JSONB NOT NULL,

    CONSTRAINT "Choice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NpcIntention" (
    "id" TEXT NOT NULL,
    "scenarioVersionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "actorType" TEXT NOT NULL,
    "actorKey" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "conditions" JSONB NOT NULL,
    "effects" JSONB NOT NULL,
    "once" BOOLEAN NOT NULL DEFAULT true,
    "cooldownTicks" INTEGER NOT NULL DEFAULT 0,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "NpcIntention_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationState" (
    "id" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "tick" INTEGER NOT NULL DEFAULT 0,
    "lastTickAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimulationState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimulationTick" (
    "id" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "tick" INTEGER NOT NULL,
    "trigger" "TickTrigger" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "actions" JSONB NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SimulationTick_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "IntentionRun" (
    "id" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "intentionId" TEXT NOT NULL,
    "tick" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IntentionRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerChoice" (
    "id" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "choiceKey" TEXT NOT NULL,
    "optionKey" TEXT,
    "offeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "decidedAt" TIMESTAMP(3),

    CONSTRAINT "PlayerChoice_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Hypothesis" (
    "id" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "suspectKey" TEXT NOT NULL,
    "evidenceKeys" TEXT[],
    "note" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Hypothesis_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CaseFile" (
    "id" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "suspectKey" TEXT NOT NULL,
    "evidenceKeys" TEXT[],
    "endingKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CaseFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Suspect_scenarioVersionId_key_key" ON "Suspect"("scenarioVersionId", "key");

-- CreateIndex
CREATE INDEX "EvidenceLink_scenarioVersionId_idx" ON "EvidenceLink"("scenarioVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "Ending_scenarioVersionId_key_key" ON "Ending"("scenarioVersionId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Choice_scenarioVersionId_key_key" ON "Choice"("scenarioVersionId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "NpcIntention_scenarioVersionId_key_key" ON "NpcIntention"("scenarioVersionId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "SimulationState_gameSessionId_key" ON "SimulationState"("gameSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "SimulationTick_gameSessionId_idempotencyKey_key" ON "SimulationTick"("gameSessionId", "idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SimulationTick_gameSessionId_tick_key" ON "SimulationTick"("gameSessionId", "tick");

-- CreateIndex
CREATE INDEX "IntentionRun_gameSessionId_intentionId_idx" ON "IntentionRun"("gameSessionId", "intentionId");

-- CreateIndex
CREATE UNIQUE INDEX "IntentionRun_gameSessionId_intentionId_tick_key" ON "IntentionRun"("gameSessionId", "intentionId", "tick");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerChoice_gameSessionId_choiceKey_key" ON "PlayerChoice"("gameSessionId", "choiceKey");

-- CreateIndex
CREATE INDEX "Hypothesis_gameSessionId_idx" ON "Hypothesis"("gameSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "CaseFile_gameSessionId_key" ON "CaseFile"("gameSessionId");

-- AddForeignKey
ALTER TABLE "Suspect" ADD CONSTRAINT "Suspect_scenarioVersionId_fkey" FOREIGN KEY ("scenarioVersionId") REFERENCES "ScenarioVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "EvidenceLink" ADD CONSTRAINT "EvidenceLink_scenarioVersionId_fkey" FOREIGN KEY ("scenarioVersionId") REFERENCES "ScenarioVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Ending" ADD CONSTRAINT "Ending_scenarioVersionId_fkey" FOREIGN KEY ("scenarioVersionId") REFERENCES "ScenarioVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Choice" ADD CONSTRAINT "Choice_scenarioVersionId_fkey" FOREIGN KEY ("scenarioVersionId") REFERENCES "ScenarioVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NpcIntention" ADD CONSTRAINT "NpcIntention_scenarioVersionId_fkey" FOREIGN KEY ("scenarioVersionId") REFERENCES "ScenarioVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationState" ADD CONSTRAINT "SimulationState_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SimulationTick" ADD CONSTRAINT "SimulationTick_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntentionRun" ADD CONSTRAINT "IntentionRun_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "IntentionRun" ADD CONSTRAINT "IntentionRun_intentionId_fkey" FOREIGN KEY ("intentionId") REFERENCES "NpcIntention"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerChoice" ADD CONSTRAINT "PlayerChoice_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Hypothesis" ADD CONSTRAINT "Hypothesis_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CaseFile" ADD CONSTRAINT "CaseFile_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

