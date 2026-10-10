import "dotenv/config";

/** The integration tests' database. Refuses anything that isn't clearly a separate test database. */
export function testDatabaseUrl(): string {
  const url = process.env.TEST_DATABASE_URL;
  if (!url) throw new Error("TEST_DATABASE_URL is not set (see .env.example)");
  const name = new URL(url).pathname.slice(1);
  const appDatabase = process.env.APP_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!name.includes("test") || url === appDatabase) {
    throw new Error(`Refusing to run integration tests against "${name}": TEST_DATABASE_URL must be a separate database with "test" in its name`);
  }
  return url;
}
