import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";

export type { PrismaClient };
export type TransactionClient = Parameters<Parameters<PrismaClient["$transaction"]>[0]>[0];

/** Shared by the app, the seed script and the tests (which point it at the test database). */
export function createPrismaClient(connectionString: string | undefined): PrismaClient {
  if (!connectionString) throw new Error("DATABASE_URL is not set. Copy .env.example to .env (see README).");
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}
