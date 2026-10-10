import { testDatabaseUrl } from "./test-database";

// Route handlers import the app's Prisma client, which reads DATABASE_URL: point it at the test DB.
const url = testDatabaseUrl();
process.env.APP_DATABASE_URL ??= process.env.DATABASE_URL;
process.env.DATABASE_URL = url;
