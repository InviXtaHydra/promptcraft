import { execSync } from "node:child_process";
import { neonBabylon } from "../../src/content/neon-babylon";
import { createPrismaClient } from "../../src/server/prisma-client";
import { seedScenario } from "../../src/server/seed-scenario";
import { testDatabaseUrl } from "./test-database";

/**
 * Brings the test database to the current schema and seeds the scenario. The test database belongs
 * to the tests alone, so leftover players from an earlier run are removed (cascades to their games),
 * along with the Creator Mode scenarios the tests made.
 */
export default async function setup() {
  const url = testDatabaseUrl();
  execSync("npx prisma migrate deploy", { env: { ...process.env, DATABASE_URL: url }, stdio: "pipe" });
  const prisma = createPrismaClient(url);
  try {
    await prisma.user.deleteMany({});
    await prisma.scenario.deleteMany({ where: { slug: { not: neonBabylon.slug } } });
    await seedScenario(prisma, neonBabylon);
  } finally {
    await prisma.$disconnect();
  }
}
