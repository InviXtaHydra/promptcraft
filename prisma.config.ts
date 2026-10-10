import "dotenv/config";
import { defineConfig } from "prisma/config";

export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    // Optional here so `prisma generate` (and `npm install`) work before .env exists;
    // migrate and seed commands fail with a clear message when it's missing.
    url: process.env.DATABASE_URL,
  },
});
