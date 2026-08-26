import { createBscPublicClient } from "@relic/blockchain";
import { getServerEnvironment } from "@relic/config";
import { createDatabase, DrizzleCommerceStore } from "@relic/database";

import { reconcileCommerceOperations } from "./commerce-operation-worker.js";

const environment = getServerEnvironment();
if (environment.DATABASE_URL === undefined)
  throw new Error("DATABASE_URL is required for commerce reconciliation");

const intervalMs = 15_000;
const client = createBscPublicClient(97, environment.BSC_TESTNET_RPC_URL);
const connection = createDatabase(environment.DATABASE_URL, { max: 2 });
const store = new DrizzleCommerceStore(connection.db);
const workerId = `commerce-reconciler-${process.pid}`;
let stopping = false;

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));
const log = (entry: Record<string, unknown>) =>
  console.info(JSON.stringify(entry));

const shutdown = async () => {
  stopping = true;
  await connection.close();
};
process.once("SIGINT", () => void shutdown());
process.once("SIGTERM", () => void shutdown());

log({
  event: "commerce_reconciler_started",
  workerId,
  chainId: 97,
  confirmationDepth: environment.ERC8004_CONFIRMATION_DEPTH,
  intervalMs,
  transactionSubmissionEnabled: false,
});

while (!stopping) {
  try {
    const result = await reconcileCommerceOperations({
      store,
      client,
      workerId,
      confirmationDepth: environment.ERC8004_CONFIRMATION_DEPTH,
      ...(environment.ERC8183_POLICY_ADDRESS === undefined
        ? {}
        : { policyAddress: environment.ERC8183_POLICY_ADDRESS }),
    });
    if (result.leased > 0)
      log({
        event: "commerce_operations_reconciled",
        ...result,
        transactionSubmissionEnabled: false,
      });
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "commerce_reconciliation_cycle_failed",
        workerId,
        error: error instanceof Error ? error.message : String(error),
      }),
    );
  }
  if (!stopping) await delay(intervalMs);
}
