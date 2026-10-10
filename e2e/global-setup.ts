import { execSync } from "node:child_process";

/** Migrates and seeds the test database (see tests/support/integration-global-setup.ts). */
export default function globalSetup() {
  execSync("npx tsx tests/support/prepare-test-db.ts", { stdio: "inherit" });
}
