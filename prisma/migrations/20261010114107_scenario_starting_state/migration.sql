-- AlterTable
ALTER TABLE "ScenarioVersion" ADD COLUMN     "startingCredits" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "startingItems" JSONB NOT NULL DEFAULT '[]';
