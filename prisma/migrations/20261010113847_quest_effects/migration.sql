-- AlterTable
ALTER TABLE "Quest" ADD COLUMN     "autoStart" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "onCompleteEffects" JSONB NOT NULL DEFAULT '[]';

-- AlterTable
ALTER TABLE "QuestObjective" ADD COLUMN     "onCompleteEffects" JSONB NOT NULL DEFAULT '[]';
