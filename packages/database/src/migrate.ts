import { migrate } from "drizzle-orm/postgres-js/migrator";

import { createDatabase } from "./client.js";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) throw new Error("DATABASE_URL is required");

const connection = createDatabase(databaseUrl, { max: 1 });
try {
  await migrate(connection.db, { migrationsFolder: "./migrations" });
} finally {
  await connection.close();
}
