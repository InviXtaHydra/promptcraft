// CLI entry for the e2e setup (Playwright loads its config as CommonJS, Prisma 7's client is ESM).
import setup from "./integration-global-setup";

setup().then(
  () => console.log("test database ready"),
  (error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  },
);
