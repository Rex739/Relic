import { serve } from "@hono/node-server";
import { getServerEnvironment } from "@relic/config";
import {
  createDatabase,
  DrizzleAgentRepository,
  DrizzleMandateStore,
  DrizzleOnboardingStore,
} from "@relic/database";
import type { AgentReadRepository } from "@relic/domain";

import { createApp } from "./app.js";
import { MandateApplicationService } from "./mandates.js";

class EmptyAgentRepository implements AgentReadRepository {
  public async list() {
    return Promise.resolve({ items: [], nextCursor: null });
  }
  public async findById() {
    return Promise.resolve(null);
  }
}

const environment = getServerEnvironment();
const connection =
  environment.DATABASE_URL === undefined
    ? null
    : createDatabase(environment.DATABASE_URL);
const repository =
  connection === null
    ? new EmptyAgentRepository()
    : new DrizzleAgentRepository(connection.db);
const onboarding =
  connection === null ? undefined : new DrizzleOnboardingStore(connection.db);
const mandates =
  connection === null
    ? undefined
    : new MandateApplicationService(
        repository,
        new DrizzleMandateStore(connection.db),
      );
const mandateApiSecret =
  environment.MANDATE_API_SECRET ??
  (environment.NODE_ENV === "production"
    ? undefined
    : "relic-local-development-mandate-secret-not-production");
if (mandates !== undefined && mandateApiSecret === undefined)
  throw new Error("MANDATE_API_SECRET is required when mandates are enabled");
const app = createApp(repository, onboarding, mandates, {
  ...(mandateApiSecret === undefined ? {} : { mandateApiSecret }),
});

serve({ fetch: app.fetch, port: environment.API_PORT }, (info) => {
  console.info(`Relic API listening on http://localhost:${info.port}`);
});

if (connection !== null) {
  const shutdown = async () => {
    await connection.close();
    process.exit(0);
  };
  process.on("SIGINT", () => void shutdown());
  process.on("SIGTERM", () => void shutdown());
}
