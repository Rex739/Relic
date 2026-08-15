import type {
  Scan8004Provider,
  ScanAgent,
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
  startRun(input: {
    chainId: number;
    registryAddress: string;
    startPage: number;
    pageSize: number;
  }): Promise<string>;
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
  recordMalformed(
    raw: unknown,
    page: number,
    index: number,
    error: unknown,
  ): Promise<void>;
  completePage(input: {
    runId: string;
    chainId: number;
    registryAddress: string;
    page: number;
    pageSize: number;
    total: number;
    counters: BootstrapCounters;
    rateLimit: ScanRateLimit;
    advanceCheckpoint: boolean;
  }): Promise<void>;
  finishRun(input: {
    runId: string;
    chainId: number;
    registryAddress: string;
    status: "succeeded" | "partial" | "failed";
    counters: BootstrapCounters;
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
    logger?: (entry: Record<string, unknown>) => void;
  },
): Promise<BootstrapResult> {
  const checkpoint = await store.checkpoint(
    options.chainId,
    options.registryAddress,
    options.pageSize,
  );
  const startPage = options.startPage ?? checkpoint.nextPage;
  if (
    options.startPage === undefined &&
    checkpoint.nextPage > 1 &&
    checkpoint.pageSize !== undefined &&
    checkpoint.pageSize !== options.pageSize
  )
    throw new Error(
      `Resume page size must remain ${checkpoint.pageSize}; use --start-page only for an explicit replay`,
    );
  const concurrency = options.concurrency ?? 3;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8)
    throw new Error("Corpus bootstrap concurrency must be between 1 and 8");
  const runId = await store.startRun({
    chainId: options.chainId,
    registryAddress: options.registryAddress,
    startPage,
    pageSize: options.pageSize,
  });
  const counters: BootstrapCounters = {
    pages: 0,
    seen: 0,
    imported: 0,
    rejected: 0,
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
      totalReported = page.total;
      const fetchedAt = new Date();
      for (let offset = 0; offset < page.agents.length; offset += concurrency) {
        await Promise.all(
          page.agents
            .slice(offset, offset + concurrency)
            .map(async (raw, chunkIndex) => {
              const index = offset + chunkIndex;
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
                const derived = deriveScanAgent(agent);
                await store.persistAgent({
                  agent,
                  raw,
                  fetchedAt,
                  derived,
                });
                counters.imported += 1;
              } catch (error) {
                counters.rejected += 1;
                await store.recordMalformed(raw, pageNumber, index, error);
              }
            }),
        );
      }
      counters.pages += 1;
      endPage = pageNumber;
      await store.completePage({
        runId,
        chainId: options.chainId,
        registryAddress: options.registryAddress,
        page: pageNumber,
        pageSize: options.pageSize,
        total: page.total,
        counters,
        rateLimit: page.rateLimit,
        advanceCheckpoint: options.startPage === undefined,
      });
      options.logger?.({
        event: "corpus_page_imported",
        runId,
        page: pageNumber,
        pageSize: page.pageSize,
        total: page.total,
        hasMore: page.hasMore,
        rateLimit: page.rateLimit,
        counters,
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
    });
    return {
      runId,
      ...counters,
      startPage,
      endPage,
      totalReported,
      complete,
    };
  } catch (error) {
    await store.finishRun({
      runId,
      chainId: options.chainId,
      registryAddress: options.registryAddress,
      status: "failed",
      counters,
      error,
    });
    throw error;
  }
}
