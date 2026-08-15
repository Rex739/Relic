import { sql } from "drizzle-orm";

import { createDatabase } from "./client.js";
import { DrizzleOnboardingStore } from "./onboarding.js";

const databaseUrl = process.env.DATABASE_URL;
if (databaseUrl === undefined) throw new Error("DATABASE_URL is required");
const connection = createDatabase(databaseUrl, { max: 1 });
try {
  const store = new DrizzleOnboardingStore(connection.db);
  const [metrics, totals] = await Promise.all([
    store.metricsBySupplyType(),
    connection.db.execute(sql`
      select
        (select count(*)::int from agent_submissions) submissions,
        (select count(*)::int from ownership_challenges) ownership_challenges,
        (select count(*)::int from activation_lifecycle_transitions) lifecycle_transitions,
        (select count(*)::int from marketplace_outcomes) outcomes,
        (select count(*)::int from launch_candidates where supply_type='relic_reference') reference_candidates,
        (select count(*)::int from launch_candidates where supply_type='third_party') third_party_candidates,
        (select count(*)::int from launch_candidates where supply_type='partner') partner_candidates
    `),
  ]);
  console.info(
    JSON.stringify(
      {
        dataKind: "real-persisted-database",
        generatedAt: new Date().toISOString(),
        totals: totals[0],
        bySupplyType: metrics,
      },
      null,
      2,
    ),
  );
} finally {
  await connection.close();
}
