import {
  createBscPublicClient,
  Erc8004RegistryProvider,
  HttpMetadataResolver,
} from "@relic/blockchain";
import { getServerEnvironment } from "@relic/config";
import {
  createDatabase,
  DrizzleCommerceStore,
  DrizzleAgentWriter,
  DrizzleOnboardingStore,
  DrizzleSupplyStore,
} from "@relic/database";

import { reconcileCommerceOperations } from "./commerce-operation-worker.js";
import { materializeLaunchServices } from "./service-catalog.js";
import { inspectLaunchServices } from "./service-inspector.js";
import { onboardPendingVerifiedSellerSubmissions } from "./seller-onboarding.js";

const environment = getServerEnvironment();
if (environment.DATABASE_URL === undefined)
  throw new Error("DATABASE_URL is required for commerce reconciliation");

const intervalMs = 15_000;
const serviceInspectionIntervalMs = 60_000;
const client = createBscPublicClient(97, environment.BSC_TESTNET_RPC_URL);
const connection = createDatabase(environment.DATABASE_URL, { max: 2 });
const store = new DrizzleCommerceStore(connection.db);
const supplyStore = new DrizzleSupplyStore(connection.db);
const onboardingStore = new DrizzleOnboardingStore(connection.db);
const writer = new DrizzleAgentWriter(connection.db);
const workerId = `commerce-reconciler-${process.pid}`;
let stopping = false;
let nextServiceInspectionAt = 0;

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
  serviceInspectionIntervalMs,
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

    // Seller onboarding materializes candidates asynchronously. Every service
    // gets the provider-neutral public verification attempt; Relic never
    // collects a seller runtime credential.
    if (Date.now() >= nextServiceInspectionAt) {
      nextServiceInspectionAt = Date.now() + serviceInspectionIntervalMs;
      const onboarded = await onboardPendingVerifiedSellerSubmissions({
        onboarding: onboardingStore,
        supplyStore,
        writer,
        providerFor: (submission) => {
          if (submission.chainId !== 56 && submission.chainId !== 97)
            throw new Error(`Unsupported seller chain ${submission.chainId}`);
          return new Erc8004RegistryProvider({
            client: createBscPublicClient(
              submission.chainId,
              submission.chainId === 56
                ? environment.BSC_MAINNET_RPC_URL
                : environment.BSC_TESTNET_RPC_URL,
            ),
            chainId: submission.chainId,
            registryAddress: submission.registryAddress,
            startBlock: 0n,
            metadataResolver: new HttpMetadataResolver(),
          });
        },
      });
      if (onboarded.length > 0)
        log({ event: "seller_submissions_catalogued", onboarded });
      // Materialize every bounded cycle, not only while a new seller is being
      // imported. This lets any interrupted or previously queued submission
      // advance from an identity to its advertised service automatically.
      const catalog = await materializeLaunchServices(supplyStore, { limit: 25 });
      if (catalog.services > 0)
        log({ event: "seller_services_materialized", ...catalog });
      const inspection = await inspectLaunchServices(supplyStore, 10);
      log({ event: "launch_service_inspection_complete", ...inspection });
    }
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
