import "server-only";
import { createPrismaClient, type PrismaClient } from "./prisma-client";

// One client (and connection pool) per server process. In development, Next.js reloads modules on
// every change, so the instance is kept on globalThis to avoid opening a new pool each time.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma: PrismaClient = globalForPrisma.prisma ?? createPrismaClient(process.env.DATABASE_URL);

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = prisma;
