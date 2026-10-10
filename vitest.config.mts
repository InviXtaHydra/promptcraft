import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

// `server-only` throws outside a React Server Components build; in tests it's an empty module.
const serverOnly = fileURLToPath(new URL("./tests/support/server-only.ts", import.meta.url));

export default defineConfig({
  plugins: [react()],
  resolve: { tsconfigPaths: true, alias: { "server-only": serverOnly } },
  test: {
    projects: [
      {
        extends: true,
        test: { name: "unit", include: ["tests/unit/**/*.test.{ts,tsx}"], environment: "node" },
      },
      {
        extends: true,
        test: {
          name: "integration",
          include: ["tests/integration/**/*.test.ts"],
          environment: "node",
          globalSetup: ["tests/support/integration-global-setup.ts"],
          setupFiles: ["tests/support/integration-env.ts"],
          // One database: run files one after another
          fileParallelism: false,
          testTimeout: 30_000,
          hookTimeout: 60_000,
        },
      },
    ],
  },
});
