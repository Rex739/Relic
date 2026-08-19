import {
  createBscPublicClient,
  Erc8004EventScanner,
  Erc8004RegistryProvider,
  HttpMetadataResolver,
  isRelicChainId,
  Scan8004Provider,
} from "@relic/blockchain";
import { getServerEnvironment } from "@relic/config";
import {
  createDatabase,
  DrizzleCorpusAnalytics,
  DrizzleCorpusStore,
  DrizzleAgentRepository,
  DrizzleAgentWriter,
  DrizzleIndexerStore,
  DrizzleOnboardingStore,
  DrizzleReconciliationStore,
  DrizzleSupplyStore,
} from "@relic/database";
import { normalizeRegistryAgent } from "@relic/domain";
import { getAddress } from "viem";

import { RelicIndexer } from "./engine.js";
import { bootstrapCorpus } from "./corpus-bootstrap.js";
import { verifyCorpus } from "./corpus-verification.js";
import { CORPUS_RULE_VERSION } from "./corpus-intelligence.js";
import { observeEndpoint } from "./endpoint-observer.js";
import { reconcileAgent } from "./reconcile.js";
import {
  discoverCategorySupply,
  TARGETED_DISCOVERY_QUERIES,
  type LaunchCategory,
} from "./launch-supply.js";
import { materializeLaunchServices } from "./service-catalog.js";
import { inspectLaunchServices } from "./service-inspector.js";
import { runSafeActivationAttempt } from "./activation.js";

const environment = getServerEnvironment();
if (environment.DATABASE_URL === undefined)
  throw new Error("DATABASE_URL is required for indexing");
if (environment.ERC8004_IDENTITY_REGISTRY_ADDRESS === undefined)
  throw new Error("ERC8004_IDENTITY_REGISTRY_ADDRESS is required for indexing");
if (environment.ERC8004_START_BLOCK === undefined)
  throw new Error("ERC8004_START_BLOCK is required for bounded indexing");
if (!isRelicChainId(environment.ERC8004_CHAIN_ID))
  throw new Error("Unsupported BSC chain ID");

const command = process.argv[2] ?? "sync";
const flag = (name: string) =>
  process.argv
    .find((argument) => argument.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
const booleanFlag = (name: string) => process.argv.includes(`--${name}`);
const positiveIntegerFlag = (name: string, fallback?: number) => {
  const raw = flag(name);
  const value = raw === undefined ? fallback : Number(raw);
  if (value === undefined) return undefined;
  if (!Number.isInteger(value) || value < 1)
    throw new Error(`--${name} must be a positive integer`);
  return value;
};

const chainId = environment.ERC8004_CHAIN_ID;
const registryAddress = getAddress(
  environment.ERC8004_IDENTITY_REGISTRY_ADDRESS,
);
const rpcUrl =
  chainId === 56
    ? environment.BSC_MAINNET_RPC_URL
    : environment.BSC_TESTNET_RPC_URL;
const client = createBscPublicClient(chainId, rpcUrl);
const metadataResolver = new HttpMetadataResolver();
const provider = new Erc8004RegistryProvider({
  client,
  chainId,
  registryAddress,
  startBlock: BigInt(environment.ERC8004_START_BLOCK),
  blockRange: BigInt(environment.ERC8004_BLOCK_RANGE),
  metadataResolver,
});
const connection = createDatabase(environment.DATABASE_URL, { max: 3 });
const writer = new DrizzleAgentWriter(connection.db);
const repository = new DrizzleAgentRepository(connection.db);
const log = (entry: Record<string, unknown>) =>
  console.info(
    JSON.stringify(entry, (_key, value: unknown) =>
      typeof value === "bigint" ? value.toString() : value,
    ),
  );

try {
  if (command === "supply-discover") {
    const limit = positiveIntegerFlag("limit", 10)!;
    if (limit > 25)
      throw new Error(
        "Targeted discovery is bounded to 25 results per category",
      );
    const requestedCategory = flag("category");
    const requestedQuery = flag("query");
    const discoveryMode = booleanFlag("keyword") ? "keyword" : "semantic";
    const categories = Object.keys(
      TARGETED_DISCOVERY_QUERIES,
    ) as LaunchCategory[];
    if (
      requestedCategory !== undefined &&
      !categories.includes(requestedCategory as LaunchCategory)
    )
      throw new Error(`Unknown launch category: ${requestedCategory}`);
    const selected =
      requestedCategory === undefined
        ? categories
        : [requestedCategory as LaunchCategory];
    const secondary = new Scan8004Provider(
      environment["8004SCAN_API_KEY"] === undefined
        ? { timeoutMs: 10_000, maxRetries: 0 }
        : {
            apiKey: environment["8004SCAN_API_KEY"],
            timeoutMs: 10_000,
            maxRetries: 0,
          },
    );
    const corpusStore = new DrizzleCorpusStore(connection.db);
    const supplyStore = new DrizzleSupplyStore(connection.db);
    const recoveredRuns = await supplyStore.failRunningDiscoveryRuns(
      "Recovered after an interrupted upstream 8004scan gateway request",
    );
    if (recoveredRuns > 0)
      log({ event: "targeted_discovery_runs_recovered", recoveredRuns });
    for (const category of selected) {
      try {
        log({
          event: "targeted_discovery_complete",
          ...(await discoverCategorySupply(
            secondary,
            corpusStore,
            supplyStore,
            {
              category,
              chainId,
              registryAddress,
              limit,
              mode: discoveryMode,
              ...(requestedQuery === undefined
                ? {}
                : { query: requestedQuery }),
            },
          )),
        });
      } catch (error) {
        log({
          event: "targeted_discovery_failed",
          category,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
  } else if (command === "supply-materialize") {
    const limit = positiveIntegerFlag("limit", 100)!;
    log({
      event: "launch_services_materialized",
      ...(await materializeLaunchServices(
        new DrizzleSupplyStore(connection.db),
        { limit },
      )),
    });
  } else if (command === "supply-inspect") {
    const limit = positiveIntegerFlag("limit", 10)!;
    if (limit > 25)
      throw new Error("Service inspection is bounded to 25 services per run");
    log({
      event: "launch_service_inspection_complete",
      ...(await inspectLaunchServices(
        new DrizzleSupplyStore(connection.db),
        limit,
      )),
    });
  } else if (command === "supply-activate") {
    log({
      event: "safe_activation_attempt_complete",
      ...(await runSafeActivationAttempt(
        new DrizzleSupplyStore(connection.db),
        environment.BSC_TESTNET_RPC_URL,
      )),
    });
  } else if (command === "supply-report") {
    log({
      event: "launch_supply_report",
      report: await new DrizzleSupplyStore(connection.db).report(),
    });
  } else if (command === "supply-onboard") {
    const submissionId = flag("submission-id");
    if (submissionId === undefined)
      throw new Error("supply-onboard requires --submission-id=<uuid>");
    const onboarding = new DrizzleOnboardingStore(connection.db);
    const submission = await onboarding.findSubmission(submissionId);
    if (submission === null)
      throw new Error(`Submission ${submissionId} does not exist`);
    if (submission.chainId !== chainId)
      throw new Error(
        `Submission chain ${submission.chainId} does not match configured canonical indexer chain ${chainId}`,
      );
    const category = submission.developerOverrides.categorySlug;
    if (typeof category !== "string")
      throw new Error(
        "Submission needs a developer-declared categorySlug before curation",
      );
    if (submission.status === "SUBMITTED")
      await onboarding.transitionSubmission({
        submissionId,
        from: "SUBMITTED",
        to: "IDENTITY_CHECK",
        evidence: {
          provider: "direct-erc8004-registry",
          chainId,
          registryAddress,
        },
      });
    const record = await provider.getAgent(submission.externalAgentId);
    if (record === null) {
      await onboarding.transitionSubmission({
        submissionId,
        from: "IDENTITY_CHECK",
        to: "BLOCKED",
        evidence: {
          reason: "onchain_identity_not_found",
          chainId,
          registryAddress,
        },
      });
      throw new Error(
        `Agent ${submission.externalAgentId} does not exist on the configured registry`,
      );
    }
    const internalId = await writer.persist(
      normalizeRegistryAgent(record),
      record,
    );
    await onboarding.transitionSubmission({
      submissionId,
      from: "IDENTITY_CHECK",
      to: "METADATA_CHECK",
      evidence: {
        canonicalAgentId: internalId,
        metadataStatus: record.metadataResolution?.status,
        provenance: "onchain_verified",
      },
      agentId: internalId,
    });
    if (record.metadataResolution?.status !== "resolved") {
      await onboarding.transitionSubmission({
        submissionId,
        from: "METADATA_CHECK",
        to: "BLOCKED",
        evidence: {
          reason: "metadata_not_resolved",
          metadataStatus: record.metadataResolution?.status,
        },
        agentId: internalId,
      });
      throw new Error("Canonical identity metadata is not resolved");
    }
    const supplyStore = new DrizzleSupplyStore(connection.db);
    await onboarding.transitionSubmission({
      submissionId,
      from: "METADATA_CHECK",
      to: "SERVICE_DISCOVERY",
      evidence: { source: "canonical-registration-file" },
      agentId: internalId,
    });
    const candidateId = await supplyStore.createOnboardingCandidate({
      agentId: internalId,
      categorySlug: category,
      supplyType: submission.supplyType,
      submissionId,
    });
    const materialized = await materializeLaunchServices(supplyStore, {
      limit: 25,
    });
    await onboarding.transitionSubmission({
      submissionId,
      from: "SERVICE_DISCOVERY",
      to: "SERVICE_VERIFICATION",
      evidence: { candidateId, materialized },
      agentId: internalId,
      candidateId,
    });
    log({
      event: "agent_submission_onboarded",
      submissionId,
      internalId,
      candidateId,
      supplyType: submission.supplyType,
      materialized,
    });
  } else if (command === "corpus-bootstrap") {
    const pageSize = positiveIntegerFlag("page-size", 50)!;
    if (pageSize > 100) throw new Error("--page-size cannot exceed 100");
    const maxPages = positiveIntegerFlag("max-pages", 1)!;
    const concurrency = positiveIntegerFlag("concurrency", 3)!;
    if (concurrency > 3)
      throw new Error(
        "--concurrency cannot exceed the configured database pool of 3",
      );
    const startPage = positiveIntegerFlag("start-page");
    const secondary = new Scan8004Provider(
      environment["8004SCAN_API_KEY"] === undefined
        ? {}
        : { apiKey: environment["8004SCAN_API_KEY"] },
    );
    const result = await bootstrapCorpus(
      secondary,
      new DrizzleCorpusStore(connection.db),
      {
        chainId,
        registryAddress,
        pageSize,
        maxPages,
        concurrency,
        ...(startPage === undefined ? {} : { startPage }),
        logger: log,
      },
    );
    log({ event: "corpus_bootstrap_complete", ...result });
  } else if (command === "corpus-verify") {
    const limit = positiveIntegerFlag("limit", 5)!;
    const corpusStore = new DrizzleCorpusStore(connection.db);
    const requeued = booleanFlag("retry-failed")
      ? await corpusStore.requeueFailedVerifications()
      : 0;
    const result = await verifyCorpus(provider, writer, corpusStore, {
      limit,
      blockNumber: await client.getBlockNumber(),
      logger: log,
    });
    log({ event: "corpus_verification_complete", requeued, ...result });
  } else if (command === "corpus-observe-endpoints") {
    const limit = positiveIntegerFlag("limit", 5)!;
    if (limit > 25)
      throw new Error("Endpoint observation is bounded to 25 per run");
    const store = new DrizzleCorpusStore(connection.db);
    const candidates = await store.endpointCandidates(limit);
    for (const candidate of candidates) {
      const observation = await observeEndpoint(candidate.endpoint);
      await store.recordEndpointObservation({
        agentId: candidate.agent_id,
        serviceDeclarationId: candidate.service_declaration_id,
        ...observation,
      });
      log({
        event: "endpoint_observed",
        agentId: candidate.agent_id,
        ...observation,
      });
    }
    log({
      event: "endpoint_observation_complete",
      observed: candidates.length,
    });
  } else if (command === "corpus-report") {
    const store = new DrizzleCorpusStore(connection.db);
    const duplicateSignals =
      await store.refreshDuplicateSignals(CORPUS_RULE_VERSION);
    log({
      event: "corpus_report",
      duplicateSignals,
      report: await new DrizzleCorpusAnalytics(connection.db).report(chainId),
    });
  } else if (command === "backfill" || command === "sync") {
    const scanner = new Erc8004EventScanner({
      client,
      chainId,
      registryAddress,
      batchSize: BigInt(environment.ERC8004_BLOCK_RANGE),
      minBatchSize: BigInt(environment.ERC8004_MIN_BLOCK_RANGE),
      maxRetries: environment.ERC8004_RPC_RETRIES,
    });
    const indexer = new RelicIndexer(
      scanner,
      provider,
      writer,
      new DrizzleIndexerStore(connection.db, chainId, registryAddress),
    );
    await indexer.run({
      mode: command,
      startBlock: BigInt(environment.ERC8004_START_BLOCK),
      confirmations: BigInt(environment.ERC8004_CONFIRMATION_DEPTH),
      dryRun: booleanFlag("dry-run"),
      maxBlocks: BigInt(
        positiveIntegerFlag("max-blocks", environment.INDEXER_MAX_BLOCKS) ??
          Number.MAX_SAFE_INTEGER,
      ),
      logger: log,
    });
  } else if (command === "agent") {
    const agentId = flag("id");
    if (agentId === undefined || !/^\d+$/.test(agentId))
      throw new Error("agent mode requires --id=<uint256>");
    const record = await provider.getAgent(agentId);
    if (record === null) throw new Error(`Agent ${agentId} does not exist`);
    if (booleanFlag("dry-run"))
      log({
        event: "agent_refresh_dry_run",
        agentId,
        metadataStatus: record.metadataResolution?.status,
      });
    else {
      const internalId = await writer.persist(
        normalizeRegistryAgent(record),
        record,
      );
      log({
        event: "agent_refreshed",
        agentId,
        internalId,
        metadataStatus: record.metadataResolution?.status,
      });
    }
  } else if (command === "reconcile") {
    const limit = positiveIntegerFlag("limit", 5)!;
    const secondary = new Scan8004Provider(
      environment["8004SCAN_API_KEY"] === undefined
        ? {}
        : { apiKey: environment["8004SCAN_API_KEY"] },
    );
    const store = new DrizzleReconciliationStore(connection.db);
    let mismatchCount = 0;
    for (const candidate of await store.candidates(chainId, limit)) {
      const [direct, scan] = await Promise.all([
        repository.findById(candidate.internalId),
        secondary.getAgent(chainId, candidate.externalAgentId),
      ]);
      const facts = reconcileAgent(direct, scan);
      mismatchCount += facts.filter(
        (fact) => fact.status === "mismatch",
      ).length;
      if (!booleanFlag("dry-run"))
        await store.save(
          candidate.internalId,
          facts,
          scan?.updated_at == null ? undefined : new Date(scan.updated_at),
        );
      log({
        event: "agent_reconciled",
        agentId: candidate.externalAgentId,
        facts,
      });
    }
    log({
      event: "reconciliation_complete",
      limit,
      mismatchCount,
      dryRun: booleanFlag("dry-run"),
    });
  } else if (command === "quality") {
    log({ event: "data_quality", ...(await repository.dataQuality()) });
  } else {
    throw new Error(`Unknown indexer mode: ${command}`);
  }
} finally {
  await connection.close();
}
