-- pgvector for NPC memory embeddings (Phase 2). The pgvector/pgvector image ships the extension.
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('PLAYER', 'CREATOR', 'ADMIN');

-- CreateEnum
CREATE TYPE "ScenarioVersionStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "ItemKind" AS ENUM ('TOOL', 'DATA', 'KEYCARD', 'CONSUMABLE', 'MISC');

-- CreateEnum
CREATE TYPE "ItemRarity" AS ENUM ('COMMON', 'RARE', 'EPIC', 'LEGENDARY');

-- CreateEnum
CREATE TYPE "ObjectiveKind" AS ENUM ('TALK_TO', 'VISIT_LOCATION', 'DISCOVER_EVIDENCE', 'COLLECT_ITEM', 'DELIVER_ITEM', 'ASK_ABOUT');

-- CreateEnum
CREATE TYPE "EvidenceReliability" AS ENUM ('CONFIRMED', 'LIKELY', 'UNVERIFIED', 'DISPUTED');

-- CreateEnum
CREATE TYPE "GameSessionStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "QuestStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('PLAYER', 'NPC', 'SYSTEM');

-- CreateEnum
CREATE TYPE "EventActor" AS ENUM ('PLAYER', 'NPC', 'SYSTEM');

-- CreateEnum
CREATE TYPE "WorldEventSeverity" AS ENUM ('INFO', 'NOTICE', 'WARNING', 'CRITICAL');

-- CreateEnum
CREATE TYPE "MemoryKind" AS ENUM ('EPISODIC', 'SEMANTIC', 'RELATIONSHIP', 'PROMISE', 'BETRAYAL', 'EVIDENCE', 'NEGOTIATION');

-- CreateEnum
CREATE TYPE "RunStatus" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ToolStatus" AS ENUM ('PROPOSED', 'REJECTED', 'EXECUTED', 'FAILED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "UserRole" NOT NULL DEFAULT 'PLAYER',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlayerProfile" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "callsign" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlayerProfile_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Scenario" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "authorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Scenario_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScenarioVersion" (
    "id" TEXT NOT NULL,
    "scenarioId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "ScenarioVersionStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ScenarioVersion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Location" (
    "id" TEXT NOT NULL,
    "scenarioVersionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "district" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "ambience" TEXT NOT NULL,
    "accent" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isStartingPoint" BOOLEAN NOT NULL DEFAULT false,
    "startsUnlocked" BOOLEAN NOT NULL DEFAULT false,
    "lockedReason" TEXT,

    CONSTRAINT "Location_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Faction" (
    "id" TEXT NOT NULL,
    "scenarioVersionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "accent" TEXT NOT NULL,

    CONSTRAINT "Faction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NPC" (
    "id" TEXT NOT NULL,
    "scenarioVersionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "shortBio" TEXT NOT NULL,
    "accent" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "reachableFrom" TEXT[],
    "factionId" TEXT,
    "baseTrust" INTEGER NOT NULL DEFAULT 0,
    "baseSuspicion" INTEGER NOT NULL DEFAULT 0,
    "allowedEffects" TEXT[],
    "persona" JSONB NOT NULL,

    CONSTRAINT "NPC_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ItemDefinition" (
    "id" TEXT NOT NULL,
    "scenarioVersionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kind" "ItemKind" NOT NULL,
    "rarity" "ItemRarity" NOT NULL DEFAULT 'COMMON',
    "baseValue" INTEGER NOT NULL DEFAULT 0,
    "stackable" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ItemDefinition_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationLoot" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "itemDefinitionId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "foundText" TEXT NOT NULL,

    CONSTRAINT "LocationLoot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MerchantOffer" (
    "id" TEXT NOT NULL,
    "npcId" TEXT NOT NULL,
    "itemDefinitionId" TEXT NOT NULL,
    "price" INTEGER NOT NULL,
    "discountPrice" INTEGER,
    "discountMinTrust" INTEGER,
    "stock" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "MerchantOffer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Quest" (
    "id" TEXT NOT NULL,
    "scenarioVersionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "giverNpcId" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isMain" BOOLEAN NOT NULL DEFAULT true,
    "requiresQuestKey" TEXT,
    "rewardCredits" INTEGER NOT NULL DEFAULT 0,
    "rewardItemKey" TEXT,
    "rewardText" TEXT,

    CONSTRAINT "Quest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestObjective" (
    "id" TEXT NOT NULL,
    "questId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "kind" "ObjectiveKind" NOT NULL,
    "targetKey" TEXT NOT NULL,
    "recipientKey" TEXT,
    "optional" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "QuestObjective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Evidence" (
    "id" TEXT NOT NULL,
    "scenarioVersionId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "locationId" TEXT,
    "sourceNpcId" TEXT,
    "reliability" "EvidenceReliability" NOT NULL DEFAULT 'UNVERIFIED',
    "tags" TEXT[],

    CONSTRAINT "Evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameSession" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scenarioVersionId" TEXT NOT NULL,
    "status" "GameSessionStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastPlayedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameSession_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorldState" (
    "id" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "credits" INTEGER NOT NULL,
    "currentLocationId" TEXT NOT NULL,
    "securityAlert" INTEGER NOT NULL DEFAULT 0,
    "turn" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WorldState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationAccess" (
    "id" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "unlockedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visitedAt" TIMESTAMP(3),
    "investigatedAt" TIMESTAMP(3),

    CONSTRAINT "LocationAccess_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NPCRelationship" (
    "id" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "npcId" TEXT NOT NULL,
    "trust" INTEGER NOT NULL,
    "suspicion" INTEGER NOT NULL,
    "lastInteractionAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "NPCRelationship_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "FactionReputation" (
    "id" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "factionId" TEXT NOT NULL,
    "reputation" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FactionReputation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "itemDefinitionId" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "source" TEXT NOT NULL,
    "acquiredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CollectedLoot" (
    "id" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "lootId" TEXT NOT NULL,
    "collectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CollectedLoot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "QuestState" (
    "id" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "questId" TEXT NOT NULL,
    "status" "QuestStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "rewardGrantedAt" TIMESTAMP(3),

    CONSTRAINT "QuestState_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectiveProgress" (
    "id" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObjectiveProgress_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DiscoveredEvidence" (
    "id" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "evidenceId" TEXT NOT NULL,
    "discoveredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "provenance" TEXT NOT NULL,

    CONSTRAINT "DiscoveredEvidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Conversation" (
    "id" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "npcId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Conversation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "provider" TEXT,
    "isSimulated" BOOLEAN NOT NULL DEFAULT false,
    "agentRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WorldEvent" (
    "id" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "key" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "severity" "WorldEventSeverity" NOT NULL DEFAULT 'INFO',
    "actor" "EventActor" NOT NULL,
    "actorNpcId" TEXT,
    "turn" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "WorldEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "GameEvent" (
    "id" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "actor" "EventActor" NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "turn" INTEGER NOT NULL,
    "payload" JSONB NOT NULL,
    "result" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GameEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "NPCMemory" (
    "id" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "npcId" TEXT NOT NULL,
    "kind" "MemoryKind" NOT NULL,
    "content" TEXT NOT NULL,
    "importance" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "provenance" TEXT NOT NULL,
    "embedding" vector,
    "embeddingModel" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastRecalledAt" TIMESTAMP(3),

    CONSTRAINT "NPCMemory_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentRun" (
    "id" TEXT NOT NULL,
    "gameSessionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "npcId" TEXT,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "isSimulated" BOOLEAN NOT NULL,
    "status" "RunStatus" NOT NULL DEFAULT 'RUNNING',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "latencyMs" INTEGER,
    "inputTokens" INTEGER,
    "outputTokens" INTEGER,
    "error" TEXT,

    CONSTRAINT "AgentRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgentStep" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "index" INTEGER NOT NULL,
    "node" TEXT NOT NULL,
    "status" "RunStatus" NOT NULL,
    "summary" TEXT NOT NULL,
    "data" JSONB,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "durationMs" INTEGER,

    CONSTRAINT "AgentStep_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ToolExecution" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "stepId" TEXT,
    "toolName" TEXT NOT NULL,
    "arguments" JSONB NOT NULL,
    "status" "ToolStatus" NOT NULL,
    "result" JSONB,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolExecution_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT,
    "targetId" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "AuthSession_tokenHash_key" ON "AuthSession"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthSession_userId_idx" ON "AuthSession"("userId");

-- CreateIndex
CREATE INDEX "AuthSession_expiresAt_idx" ON "AuthSession"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerProfile_userId_key" ON "PlayerProfile"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "PlayerProfile_callsign_key" ON "PlayerProfile"("callsign");

-- CreateIndex
CREATE UNIQUE INDEX "Scenario_slug_key" ON "Scenario"("slug");

-- CreateIndex
CREATE INDEX "ScenarioVersion_scenarioId_status_idx" ON "ScenarioVersion"("scenarioId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ScenarioVersion_scenarioId_version_key" ON "ScenarioVersion"("scenarioId", "version");

-- CreateIndex
CREATE UNIQUE INDEX "Location_scenarioVersionId_key_key" ON "Location"("scenarioVersionId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Faction_scenarioVersionId_key_key" ON "Faction"("scenarioVersionId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "NPC_scenarioVersionId_key_key" ON "NPC"("scenarioVersionId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "ItemDefinition_scenarioVersionId_key_key" ON "ItemDefinition"("scenarioVersionId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "LocationLoot_locationId_itemDefinitionId_key" ON "LocationLoot"("locationId", "itemDefinitionId");

-- CreateIndex
CREATE UNIQUE INDEX "MerchantOffer_npcId_itemDefinitionId_key" ON "MerchantOffer"("npcId", "itemDefinitionId");

-- CreateIndex
CREATE UNIQUE INDEX "Quest_scenarioVersionId_key_key" ON "Quest"("scenarioVersionId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "QuestObjective_questId_key_key" ON "QuestObjective"("questId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "Evidence_scenarioVersionId_key_key" ON "Evidence"("scenarioVersionId", "key");

-- CreateIndex
CREATE INDEX "GameSession_userId_lastPlayedAt_idx" ON "GameSession"("userId", "lastPlayedAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorldState_gameSessionId_key" ON "WorldState"("gameSessionId");

-- CreateIndex
CREATE UNIQUE INDEX "LocationAccess_gameSessionId_locationId_key" ON "LocationAccess"("gameSessionId", "locationId");

-- CreateIndex
CREATE UNIQUE INDEX "NPCRelationship_gameSessionId_npcId_key" ON "NPCRelationship"("gameSessionId", "npcId");

-- CreateIndex
CREATE UNIQUE INDEX "FactionReputation_gameSessionId_factionId_key" ON "FactionReputation"("gameSessionId", "factionId");

-- CreateIndex
CREATE UNIQUE INDEX "InventoryItem_gameSessionId_itemDefinitionId_key" ON "InventoryItem"("gameSessionId", "itemDefinitionId");

-- CreateIndex
CREATE UNIQUE INDEX "CollectedLoot_gameSessionId_lootId_key" ON "CollectedLoot"("gameSessionId", "lootId");

-- CreateIndex
CREATE UNIQUE INDEX "QuestState_gameSessionId_questId_key" ON "QuestState"("gameSessionId", "questId");

-- CreateIndex
CREATE UNIQUE INDEX "ObjectiveProgress_gameSessionId_objectiveId_key" ON "ObjectiveProgress"("gameSessionId", "objectiveId");

-- CreateIndex
CREATE UNIQUE INDEX "DiscoveredEvidence_gameSessionId_evidenceId_key" ON "DiscoveredEvidence"("gameSessionId", "evidenceId");

-- CreateIndex
CREATE UNIQUE INDEX "Conversation_gameSessionId_npcId_key" ON "Conversation"("gameSessionId", "npcId");

-- CreateIndex
CREATE INDEX "Message_conversationId_createdAt_idx" ON "Message"("conversationId", "createdAt");

-- CreateIndex
CREATE INDEX "WorldEvent_gameSessionId_createdAt_idx" ON "WorldEvent"("gameSessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "WorldEvent_gameSessionId_key_key" ON "WorldEvent"("gameSessionId", "key");

-- CreateIndex
CREATE INDEX "GameEvent_gameSessionId_createdAt_idx" ON "GameEvent"("gameSessionId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "GameEvent_gameSessionId_idempotencyKey_key" ON "GameEvent"("gameSessionId", "idempotencyKey");

-- CreateIndex
CREATE INDEX "NPCMemory_gameSessionId_npcId_createdAt_idx" ON "NPCMemory"("gameSessionId", "npcId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "NPCMemory_gameSessionId_npcId_contentHash_key" ON "NPCMemory"("gameSessionId", "npcId", "contentHash");

-- CreateIndex
CREATE INDEX "AgentRun_gameSessionId_startedAt_idx" ON "AgentRun"("gameSessionId", "startedAt");

-- CreateIndex
CREATE INDEX "AgentRun_userId_startedAt_idx" ON "AgentRun"("userId", "startedAt");

-- CreateIndex
CREATE UNIQUE INDEX "AgentStep_runId_index_key" ON "AgentStep"("runId", "index");

-- CreateIndex
CREATE INDEX "ToolExecution_runId_idx" ON "ToolExecution"("runId");

-- CreateIndex
CREATE INDEX "AuditLog_userId_createdAt_idx" ON "AuditLog"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_action_createdAt_idx" ON "AuditLog"("action", "createdAt");

-- AddForeignKey
ALTER TABLE "AuthSession" ADD CONSTRAINT "AuthSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PlayerProfile" ADD CONSTRAINT "PlayerProfile_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Scenario" ADD CONSTRAINT "Scenario_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScenarioVersion" ADD CONSTRAINT "ScenarioVersion_scenarioId_fkey" FOREIGN KEY ("scenarioId") REFERENCES "Scenario"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Location" ADD CONSTRAINT "Location_scenarioVersionId_fkey" FOREIGN KEY ("scenarioVersionId") REFERENCES "ScenarioVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Faction" ADD CONSTRAINT "Faction_scenarioVersionId_fkey" FOREIGN KEY ("scenarioVersionId") REFERENCES "ScenarioVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NPC" ADD CONSTRAINT "NPC_scenarioVersionId_fkey" FOREIGN KEY ("scenarioVersionId") REFERENCES "ScenarioVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NPC" ADD CONSTRAINT "NPC_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NPC" ADD CONSTRAINT "NPC_factionId_fkey" FOREIGN KEY ("factionId") REFERENCES "Faction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ItemDefinition" ADD CONSTRAINT "ItemDefinition_scenarioVersionId_fkey" FOREIGN KEY ("scenarioVersionId") REFERENCES "ScenarioVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationLoot" ADD CONSTRAINT "LocationLoot_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationLoot" ADD CONSTRAINT "LocationLoot_itemDefinitionId_fkey" FOREIGN KEY ("itemDefinitionId") REFERENCES "ItemDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantOffer" ADD CONSTRAINT "MerchantOffer_npcId_fkey" FOREIGN KEY ("npcId") REFERENCES "NPC"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MerchantOffer" ADD CONSTRAINT "MerchantOffer_itemDefinitionId_fkey" FOREIGN KEY ("itemDefinitionId") REFERENCES "ItemDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quest" ADD CONSTRAINT "Quest_scenarioVersionId_fkey" FOREIGN KEY ("scenarioVersionId") REFERENCES "ScenarioVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Quest" ADD CONSTRAINT "Quest_giverNpcId_fkey" FOREIGN KEY ("giverNpcId") REFERENCES "NPC"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestObjective" ADD CONSTRAINT "QuestObjective_questId_fkey" FOREIGN KEY ("questId") REFERENCES "Quest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_scenarioVersionId_fkey" FOREIGN KEY ("scenarioVersionId") REFERENCES "ScenarioVersion"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Evidence" ADD CONSTRAINT "Evidence_sourceNpcId_fkey" FOREIGN KEY ("sourceNpcId") REFERENCES "NPC"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameSession" ADD CONSTRAINT "GameSession_scenarioVersionId_fkey" FOREIGN KEY ("scenarioVersionId") REFERENCES "ScenarioVersion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldState" ADD CONSTRAINT "WorldState_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldState" ADD CONSTRAINT "WorldState_currentLocationId_fkey" FOREIGN KEY ("currentLocationId") REFERENCES "Location"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationAccess" ADD CONSTRAINT "LocationAccess_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationAccess" ADD CONSTRAINT "LocationAccess_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "Location"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NPCRelationship" ADD CONSTRAINT "NPCRelationship_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NPCRelationship" ADD CONSTRAINT "NPCRelationship_npcId_fkey" FOREIGN KEY ("npcId") REFERENCES "NPC"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactionReputation" ADD CONSTRAINT "FactionReputation_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "FactionReputation" ADD CONSTRAINT "FactionReputation_factionId_fkey" FOREIGN KEY ("factionId") REFERENCES "Faction"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_itemDefinitionId_fkey" FOREIGN KEY ("itemDefinitionId") REFERENCES "ItemDefinition"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectedLoot" ADD CONSTRAINT "CollectedLoot_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CollectedLoot" ADD CONSTRAINT "CollectedLoot_lootId_fkey" FOREIGN KEY ("lootId") REFERENCES "LocationLoot"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestState" ADD CONSTRAINT "QuestState_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "QuestState" ADD CONSTRAINT "QuestState_questId_fkey" FOREIGN KEY ("questId") REFERENCES "Quest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectiveProgress" ADD CONSTRAINT "ObjectiveProgress_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectiveProgress" ADD CONSTRAINT "ObjectiveProgress_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "QuestObjective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredEvidence" ADD CONSTRAINT "DiscoveredEvidence_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DiscoveredEvidence" ADD CONSTRAINT "DiscoveredEvidence_evidenceId_fkey" FOREIGN KEY ("evidenceId") REFERENCES "Evidence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_npcId_fkey" FOREIGN KEY ("npcId") REFERENCES "NPC"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_agentRunId_fkey" FOREIGN KEY ("agentRunId") REFERENCES "AgentRun"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WorldEvent" ADD CONSTRAINT "WorldEvent_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "GameEvent" ADD CONSTRAINT "GameEvent_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NPCMemory" ADD CONSTRAINT "NPCMemory_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "NPCMemory" ADD CONSTRAINT "NPCMemory_npcId_fkey" FOREIGN KEY ("npcId") REFERENCES "NPC"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_gameSessionId_fkey" FOREIGN KEY ("gameSessionId") REFERENCES "GameSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentRun" ADD CONSTRAINT "AgentRun_npcId_fkey" FOREIGN KEY ("npcId") REFERENCES "NPC"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AgentStep" ADD CONSTRAINT "AgentStep_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolExecution" ADD CONSTRAINT "ToolExecution_runId_fkey" FOREIGN KEY ("runId") REFERENCES "AgentRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ToolExecution" ADD CONSTRAINT "ToolExecution_stepId_fkey" FOREIGN KEY ("stepId") REFERENCES "AgentStep"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- Bounds the game engine already enforces, kept here as a second line of defence.
ALTER TABLE "WorldState" ADD CONSTRAINT "WorldState_credits_nonnegative" CHECK ("credits" >= 0);
ALTER TABLE "WorldState" ADD CONSTRAINT "WorldState_securityAlert_range" CHECK ("securityAlert" BETWEEN 0 AND 5);
ALTER TABLE "NPCRelationship" ADD CONSTRAINT "NPCRelationship_trust_range" CHECK ("trust" BETWEEN -100 AND 100);
ALTER TABLE "NPCRelationship" ADD CONSTRAINT "NPCRelationship_suspicion_range" CHECK ("suspicion" BETWEEN 0 AND 100);
ALTER TABLE "FactionReputation" ADD CONSTRAINT "FactionReputation_reputation_range" CHECK ("reputation" BETWEEN -100 AND 100);
ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_quantity_positive" CHECK ("quantity" > 0);
ALTER TABLE "MerchantOffer" ADD CONSTRAINT "MerchantOffer_price_nonnegative" CHECK ("price" >= 0 AND ("discountPrice" IS NULL OR "discountPrice" >= 0));
ALTER TABLE "NPCMemory" ADD CONSTRAINT "NPCMemory_importance_range" CHECK ("importance" BETWEEN 1 AND 10);
