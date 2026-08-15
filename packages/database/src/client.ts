import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import * as schema from "./schema.js";

export function createDatabase(
  databaseUrl: string,
  options: { max?: number } = {},
) {
  const client = postgres(databaseUrl, {
    max: options.max ?? 5,
    prepare: false,
    idle_timeout: 20,
    connect_timeout: 10,
  });
  return { db: drizzle(client, { schema }), close: () => client.end() };
}

export type RelicDatabase = ReturnType<typeof createDatabase>["db"];
