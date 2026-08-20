import type {
  Scan8004Provider,
  ScanAccessMode,
  ScanAgent,
  ScanOperationalMode,
  ScanRateLimit,
} from "@relic/blockchain";

import {
  classifyAgent,
  CORPUS_RULE_VERSION,
  extractServiceDeclarations,
  normalizeCapabilities,
  profileQuality,
} from "./corpus-intelligence.js";

export interface BootstrapCheckpoint {
  nextPage: number;
  pageSize?: number;
}

export interface BootstrapStore {
  checkpoint(
    chainId: number,
    registryAddress: string,
    pageSize: number,
  ): Promise<BootstrapCheckpoint>;
  repageCheckpoint(input: {
    chainId: number;
    registryAddress: string;
    previousNextPage: number;
    previousPageSize: number;
    nextPageSize: number;
  }): Promise<BootstrapCheckpoint>;
  startRun(input: {
    chainId: number;
    registryAddress: string;
    startPage: number;
    pageSize: number;
    accessMode: ScanAccessMode;
    requestBudget: number;
  }): Promise<string>;
  persistDiscoveryPage(input: {
    records: Array<{ agent: ScanAgent; raw: unknown; fetchedAt: Date }>;
    malformed: Array<{
      raw: unknown;
      page: number;
      index: number;
      error: unknown;
    }>;
  }): Promise<{
    persisted: number;
    malformed: number;
    statements: number;
    transactionCount: number;
    durationMs: number;
  }>;
  persistAgent(input: {
    agent: ScanAgent;
    raw: unknown;
    fetchedAt: Date;
    derived: {
      services: ReturnType<typeof extractServiceDeclarations>;
      capabilities: string[];
      classifications: ReturnType<typeof classifyAgent>;
      quality: {
        completenessPercent: number;
        readiness: ReturnType<typeof profileQuality>["readiness"];
        facts: Record<string, boolean>;
        ruleVersion: string;
      };
      priority: number;
    };
  }): Promise<string>;
  completePage(input: {
    runId: string;
    chainId: number;
    registryAddress: string;
    page: number;
    pageSize: number;
    total: number;
    counters: BootstrapCounters;
    rateLimit: ScanRateLimit;
    accessMode: ScanAccessMode;
    operationalMode: ScanOperationalMode;
    requestCount: number;
    advanceCheckpoint: boolean;
  }): Promise<{
    statements: number;
    transactionCount: number;
    durationMs: number;
  }>;
  finishRun(input: {
    runId: string;
    chainId: number;
    registryAddress: string;
    status: "succeeded" | "partial" | "failed";
    counters: BootstrapCounters;
    accessMode: ScanAccessMode;
    operationalMode: ScanOperationalMode;
    requestCount: number;
    rateLimit: ScanRateLimit;
    error?: unknown;
  }): Promise<void>;
}

export interface BootstrapCounters {
  pages: number;
  seen: number;
  imported: number;
  rejected: number;
}

export interface BootstrapResult extends BootstrapCounters {
  runId: string;
  startPage: number;
  endPage: number | null;
  totalReported: number | null;
  complete: boolean;
  accessMode: ScanAccessMode;
  operationalMode: ScanOperationalMode;
  requestCount: number;
  timings: BootstrapTimings;
}

export interface BootstrapTimings {
  fetchMs: number;
  jsonParseMs: number;
  responseValidationMs: number;
  agentNormalizationMs: number;
  discoveryPersistenceMs: number;
  checkpointMs: number;
  databaseStatements: number;
  databaseTransactions: number;
}

export function verificationPriority(
  agent: ScanAgent,
  completeness: number,
): number {
  return (
    completeness +
    (agent.supported_protocols.length > 0 ? 20 : 0) +
    (agent.x402_supported === true ? 15 : 0) +
    ((agent.total_feedbacks ?? 0) > 0 ? 10 : 0)
  );
}

export function deriveScanAgent(agent: ScanAgent) {
  const services = extractServiceDeclarations(agent);
  const classifications = classifyAgent(agent);
  const capabilities = normalizeCapabilities(
    services.map((service) => service.rawName),
  );
  const quality = profileQuality({
    agent,
    categoryCount: classifications.length,
  });
  return {
    services,
    capabilities,
    classifications,
    quality: { ...quality, ruleVersion: CORPUS_RULE_VERSION },
    priority: verificationPriority(agent, quality.completenessPercent),
  };
}

export async function bootstrapCorpus(
  provider: Scan8004Provider,
  store: BootstrapStore,
  options: {
    chainId: number;
    registryAddress: string;
    pageSize: number;
    maxPages: number;
    startPage?: number;
    concurrency?: number;
    requestBudget: number;
    requirePro?: boolean;
    logger?: (entry: Record<string, unknown>) => void;
  },
): Promise<BootstrapResult> {
  const checkpoint = await store.checkpoint(
    options.chainId,
    options.registryAddress,
    options.pageSize,
  );
  let effectiveCheckpoint = checkpoint;
  if (
    options.startPage === undefined &&
    checkpoint.nextPage > 1 &&
    checkpoint.pageSize !== undefined &&
    checkpoint.pageSize !== options.pageSize
  )
    effectiveCheckpoint = await store.repageCheckpoint({
      chainId: options.chainId,
      registryAddress: options.registryAddress,
      previousNextPage: checkpoint.nextPage,
      previousPageSize: checkpoint.pageSize,
      nextPageSize: options.pageSize,
    });
  const startPage = options.startPage ?? effectiveCheckpoint.nextPage;
  const concurrency = options.concurrency ?? 1;
  if (concurrency !== 1)
    throw new Error(
      "Discovery ingest uses one page transaction; --concurrency must be 1",
    );
  const runId = await store.startRun({
    chainId: options.chainId,
    registryAddress: options.registryAddress,
    startPage,
    pageSize: options.pageSize,
    accessMode: provider.accessMode,
    requestBudget: options.requestBudget,
  });
  const counters: BootstrapCounters = {
    pages: 0,
    seen: 0,
    imported: 0,
    rejected: 0,
  };
  const timings: BootstrapTimings = {
    fetchMs: 0,
    jsonParseMs: 0,
    responseValidationMs: 0,
    agentNormalizationMs: 0,
    discoveryPersistenceMs: 0,
    checkpointMs: 0,
    databaseStatements: 0,
    databaseTransactions: 0,
  };
  let pageNumber = startPage;
  let endPage: number | null = null;
  let totalReported: number | null = null;
  let complete = false;
  try {
    while (counters.pages < options.maxPages) {
      const page = await provider.listAgents({
        chainId: options.chainId,
        page: pageNumber,
        limit: options.pageSize,
        sortBy: "token_id",
        sortOrder: "asc",
      });
      if (
        options.requirePro === true &&
        provider.operationalMode !== "pro_authenticated"
      )
        throw new Error(
          "Full-corpus ingestion requires an API key observed at the 8004scan Pro tier",
        );
      totalReported = page.total;
      const fetchedAt = new Date();
      timings.fetchMs += page.timings.fetchMs;
      timings.jsonParseMs += page.timings.jsonParseMs;
      timings.responseValidationMs += page.timings.responseValidationMs;
      const normalizationStartedAt = performance.now();
      const records: Array<{
        agent: ScanAgent;
        raw: unknown;
        fetchedAt: Date;
      }> = [];
      const malformed: Array<{
        raw: unknown;
        page: number;
        index: number;
        error: unknown;
      }> = [];
      page.agents.forEach((raw, index) => {
        counters.seen += 1;
        try {
          const agent = provider.parseAgent(raw);
          if (
            agent.chain_id !== options.chainId ||
            agent.contract_address.toLowerCase() !==
              options.registryAddress.toLowerCase()
          )
            throw new Error(
              "Record does not match the configured BSC registry",
            );
          records.push({ agent, raw, fetchedAt });
        } catch (error) {
          malformed.push({ raw, page: pageNumber, index, error });
        }
      });
      timings.agentNormalizationMs +=
        performance.now() - normalizationStartedAt;
      const persisted = await store.persistDiscoveryPage({
        records,
        malformed,
      });
      counters.imported += persisted.persisted;
      counters.rejected += persisted.malformed;
      timings.discoveryPersistenceMs += persisted.durationMs;
      timings.databaseStatements += persisted.statements;
      timings.databaseTransactions += persisted.transactionCount;
      counters.pages += 1;
      endPage = pageNumber;
      const checkpoint = await store.completePage({
        runId,
        chainId: options.chainId,
        registryAddress: options.registryAddress,
        page: pageNumber,
        pageSize: options.pageSize,
        total: page.total,
        counters,
        rateLimit: page.rateLimit,
        accessMode: provider.accessMode,
        operationalMode: provider.operationalMode,
        requestCount: provider.requestCount,
        advanceCheckpoint: options.startPage === undefined,
      });
      timings.checkpointMs += checkpoint.durationMs;
      timings.databaseStatements += checkpoint.statements;
      timings.databaseTransactions += checkpoint.transactionCount;
      options.logger?.({
        event: "corpus_page_imported",
        runId,
        page: pageNumber,
        pageSize: page.pageSize,
        total: page.total,
        hasMore: page.hasMore,
        rateLimit: page.rateLimit,
        counters,
        timings,
      });
      if (!page.hasMore) {
        complete = true;
        break;
      }
      pageNumber += 1;
    }
    await store.finishRun({
      runId,
      chainId: options.chainId,
      registryAddress: options.registryAddress,
      status: complete ? "succeeded" : "partial",
      counters,
      accessMode: provider.accessMode,
      operationalMode: provider.operationalMode,
      requestCount: provider.requestCount,
      rateLimit: provider.lastRateLimit,
    });
    return {
      runId,
      ...counters,
      startPage,
      endPage,
      totalReported,
      complete,
      accessMode: provider.accessMode,
      operationalMode: provider.operationalMode,
      requestCount: provider.requestCount,
      timings,
    };
  } catch (error) {
    await store.finishRun({
      runId,
      chainId: options.chainId,
      registryAddress: options.registryAddress,
      status: "failed",
      counters,
      accessMode: provider.accessMode,
      operationalMode: provider.operationalMode,
      requestCount: provider.requestCount,
      rateLimit: provider.lastRateLimit,
      error,
    });
    throw error;
  }
}
