import { createServer } from "node:http";
import { loadHealthGuardConfig } from "./config.js";
import { FundedHealthGuardSessionClient } from "./funded-session-client.js";
import { FundedHealthGuardJobDirectory } from "./funded-job-directory.js";
import { PerJobAltanaHealthGuardSigner } from "./per-job-altana-signer.js";
import { HealthGuardPrivateExecutor } from "./private-executor.js";
import { healthGuardPrivateRuntimeHandler } from "./private-runtime.js";
import { RelicHealthGuardCycleStore } from "./relic-cycle-store.js";
import { VenusMainnetHealthReader } from "./venus-reader.js";
import { HealthGuardScheduler } from "./scheduler.js";

const port = Number(process.env.PORT ?? "9000");
const bearerToken = process.env.PRIVATE_AGENT_BEARER_TOKEN?.trim();
const apiUrl = process.env.RELIC_API_URL?.trim();
const internalToken = process.env.RELIC_HEALTH_GUARD_INTERNAL_TOKEN?.trim();
const transferPrivateKey = process.env.RELIC_HEALTH_GUARD_SESSION_TRANSFER_PRIVATE_KEY?.trim();
if (!bearerToken || !apiUrl || !internalToken || !transferPrivateKey)
  throw new Error("PRIVATE_AGENT_BEARER_TOKEN, RELIC_API_URL, RELIC_HEALTH_GUARD_INTERNAL_TOKEN, and RELIC_HEALTH_GUARD_SESSION_TRANSFER_PRIVATE_KEY are required");

const config = loadHealthGuardConfig();
const reader = new VenusMainnetHealthReader(config);
const sessions = new FundedHealthGuardSessionClient({ apiUrl, bearerToken: internalToken, executorPrivateKeyPem: transferPrivateKey });
const cycles = new RelicHealthGuardCycleStore({ apiUrl, bearerToken: internalToken });
const executor = new HealthGuardPrivateExecutor(
  config,
  () => reader.verifyDeployment(),
  (commerceJobId) => sessions.canonicalExecution(commerceJobId),
  async ({ commerceJobId, canonicalJob }) => {
    const session = await sessions.release(commerceJobId);
    if (session.commerceJobId !== commerceJobId || session.walletAddress.toLowerCase() !== canonicalJob.mandate.rescueWallet.toLowerCase())
      throw new Error("Health Guard session does not match canonical rescue wallet");
    if (canonicalJob.mandate.expiresAt > session.expiresAt)
      throw new Error("Health Guard canonical mandate outlives the buyer session");
    return { signer: new PerJobAltanaHealthGuardSigner(config, session), reader, cycles };
  },
);

createServer(healthGuardPrivateRuntimeHandler(executor, bearerToken)).listen(port, "0.0.0.0", () =>
  console.info(`Relic Health Guard private executor listening on ${String(port)}`),
);

if (config.executionEnabled && process.env.HEALTH_GUARD_SCHEDULER_ENABLED === "true") {
  const pollSeconds = Number(process.env.HEALTH_GUARD_POLL_SECONDS ?? "60");
  new HealthGuardScheduler(
    new FundedHealthGuardJobDirectory({ apiUrl, bearerToken: internalToken }),
    executor,
    { pollSeconds },
  ).start(({ attempted, succeeded, recoveryRequired, failed }) =>
    console.info(`Health Guard scheduler: attempted=${String(attempted)} succeeded=${String(succeeded)} recovery=${String(recoveryRequired)} failed=${String(failed)}`),
  );
} else {
  console.info("Health Guard scheduler is disabled");
}
