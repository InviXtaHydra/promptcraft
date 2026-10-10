/**
 * Seeds the scenario content (locations, NPCs, items, quests, evidence) and publishes it.
 *
 *   npx prisma db seed
 *
 * Safe to run repeatedly: a scenario version is immutable once seeded, because save games are pinned
 * to it. To change the content, raise `version` in src/content/neon-babylon.ts and seed again.
 * Player accounts and save games are never touched.
 */
import "dotenv/config";
import { neonBabylon } from "../src/content/neon-babylon";
import { seedScenario } from "../src/server/seed-scenario";
import { createPrismaClient } from "../src/server/prisma-client";

async function main() {
  const prisma = createPrismaClient(process.env.DATABASE_URL);
  try {
    const result = await seedScenario(prisma, neonBabylon);
    console.log(result.created ? `Seeded ${result.slug} v${result.version}` : `${result.slug} v${result.version} already seeded, left unchanged`);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
