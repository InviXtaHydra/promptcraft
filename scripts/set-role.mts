/**
 * Give a user a role, e.g. to use Creator Mode:
 *
 *   npm run user:role -- someone@example.com CREATOR
 *
 * Roles: PLAYER, CREATOR, ADMIN. Logged in the audit log.
 */
import "dotenv/config";
import { createPrismaClient } from "../src/server/prisma-client";

const [email, role] = process.argv.slice(2);
if (!email || !["PLAYER", "CREATOR", "ADMIN"].includes(role ?? "")) {
  console.error("Usage: npm run user:role -- <email> <PLAYER|CREATOR|ADMIN>");
  process.exit(1);
}
const prisma = createPrismaClient(process.env.DATABASE_URL);
const user = await prisma.user.findUnique({ where: { email: email.toLowerCase() } });
if (!user) {
  console.error(`No user with email ${email}`);
  process.exit(1);
}
await prisma.user.update({ where: { id: user.id }, data: { role: role as "PLAYER" | "CREATOR" | "ADMIN" } });
await prisma.auditLog.create({ data: { userId: user.id, action: "user.role", metadata: { role } } });
console.log(`${email} is now ${role}`);
await prisma.$disconnect();
