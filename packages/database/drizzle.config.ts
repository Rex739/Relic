import { defineConfig } from "drizzle-kit";

// Schema generation is offline, but drizzle-kit requires credentials in its config shape.
// Migration execution still requires a real DATABASE_URL in src/migrate.ts.
const databaseUrl =
  process.env.DATABASE_URL ??
  "postgresql://postgres:postgres@127.0.0.1:54322/postgres";

export default defineConfig({
  dialect: "postgresql",
  schema: "./src/schema.ts",
  out: "./migrations",
  dbCredentials: { url: databaseUrl },
  strict: true,
  verbose: true,
});
