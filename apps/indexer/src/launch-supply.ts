import type { Scan8004Provider, ScanAgent } from "@relic/blockchain";
import type {
  LaunchCandidateStatus,
  ServiceVerificationLevel,
} from "@relic/domain";

import type { BootstrapStore } from "./corpus-bootstrap.js";
import { deriveScanAgent } from "./corpus-bootstrap.js";
import { classifyAgent, normalizeServiceType } from "./corpus-intelligence.js";

export const TARGETED_DISCOVERY_QUERIES = {
  rebalancing:
    "rebalance rebalancing liquidity management LP range concentrated liquidity PancakeSwap position manager",
  "grid-trading":
    "grid trading grid strategy automated orders trading range market making",
  "yield-optimisation":
    "yield optimisation optimization APR APY farming staking lending liquidity routing Lista Venus",
  "health-factor-monitoring":
    "health factor liquidation protection lending position monitor collateral borrow Venus Aave",
} as const;

export type LaunchCategory = keyof typeof TARGETED_DISCOVERY_QUERIES;

const allowedTransitions: Record<
  LaunchCandidateStatus,
  readonly LaunchCandidateStatus[]
> = {
  DISCOVERED: ["REVIEW_PENDING", "REJECTED", "STALE"],
  REVIEW_PENDING: ["IDENTITY_VERIFIED", "REJECTED", "STALE"],
  IDENTITY_VERIFIED: ["SERVICE_IDENTIFIED", "REJECTED", "STALE"],
  SERVICE_IDENTIFIED: ["SERVICE_OBSERVED", "REJECTED", "STALE"],
  SERVICE_OBSERVED: ["INVOCATION_VERIFIED", "REJECTED", "STALE"],
  INVOCATION_VERIFIED: ["ACTIONABLE", "REJECTED", "STALE"],
  ACTIONABLE: ["STALE", "REJECTED"],
  REJECTED: [],
  STALE: ["REVIEW_PENDING", "REJECTED"],
};

export function assertCandidateTransition(
  from: LaunchCandidateStatus,
  to: LaunchCandidateStatus,
) {
  if (!allowedTransitions[from].includes(to))
    throw new Error(`Invalid launch-candidate transition: ${from} -> ${to}`);
}

const categoryTerms: Record<LaunchCategory, readonly RegExp[]> = {
  rebalancing: [
    /\brebalanc(?:e|er|ing)\b/i,
    /\b(?:concentrated liquidity|liquidity management|lp range|position manager)\b/i,
  ],
  "grid-trading": [
    /\bgrid(?:[-_\s]+trad(?:e|er|ing)|[-_\s]+strategy)\b/i,
    /\bautomated orders?\b.*\btrading range\b/i,
  ],
  "yield-optimisation": [
    /\byield(?:[-_\s]+optimi[sz](?:e|er|ation)|[-_\s]+farm(?:ing)?)\b/i,
    /\b(?:apr|apy)\b.*\b(?:staking|lending|farming|yield)\b/i,
  ],
  "health-factor-monitoring": [
    /\bhealth[-_\s]+factor(?:[-_\s]+monitor(?:ing)?|[-_\s]+alert)?\b/i,
    /\b(?:liquidation protection|lending monitor|collateral monitor)\b/i,
  ],
};

export function targetedCategoryEvidence(
  agent: ScanAgent,
  category: LaunchCategory,
): {
  confidence: "high" | "medium" | "research-lead";
  matched: Array<{ source: string; value: string }>;
} {
  const classified = classifyAgent(agent).filter(
    (item) => item.categorySlug === category,
  );
  if (classified.length > 0)
    return {
      confidence: classified.some(
        (item) => item.evidenceType === "structured_declaration",
      )
        ? "high"
        : "medium",
      matched: classified.map((item) => ({
        source: item.matchedSource,
        value: item.matchedValue,
      })),
    };
  const fields = [
    { source: "name", value: agent.name ?? "" },
    { source: "description", value: agent.description ?? "" },
    ...agent.supported_protocols.map((value) => ({
      source: "supported_protocols",
      value,
    })),
  ];
  const matched = fields.filter(({ value }) =>
    categoryTerms[category].some((pattern) => pattern.test(value)),
  );
  return {
    confidence: matched.length === 0 ? "research-lead" : "medium",
    matched,
  };
}

export interface TargetedDiscoveryStore {
  startDiscoveryRun(input: {
    chainId: number;
    categorySlug: string;
    query: string;
  }): Promise<string>;
  recordDiscovery(input: {
    runId: string;
    agentId: string;
    sourceRecordId: string;
    categorySlug: string;
    rank: number;
    query: string;
    raw: unknown;
    confidence: "high" | "medium" | "research-lead";
    matchedEvidence: Record<string, unknown>;
  }): Promise<string>;
  finishDiscoveryRun(input: {
    runId: string;
    returned: number;
    accepted: number;
    rejected: number;
    rateLimit: {
      limit: number | null;
      remaining: number | null;
      resetAt: string | null;
    };
    error?: unknown;
  }): Promise<void>;
}

export async function discoverCategorySupply(
  provider: Scan8004Provider,
  corpusStore: Pick<BootstrapStore, "persistAgent">,
  supplyStore: TargetedDiscoveryStore,
  options: {
    category: LaunchCategory;
    chainId: number;
    registryAddress: string;
    limit: number;
    query?: string;
  },
) {
  const query = options.query ?? TARGETED_DISCOVERY_QUERIES[options.category];
  const runId = await supplyStore.startDiscoveryRun({
    chainId: options.chainId,
    categorySlug: options.category,
    query,
  });
  let returned = 0;
  let accepted = 0;
  let rejected = 0;
  let rateLimit = { limit: null, remaining: null, resetAt: null } as {
    limit: number | null;
    remaining: number | null;
    resetAt: string | null;
  };
  try {
    const result = await provider.searchAgents({
      query,
      chainId: options.chainId,
      limit: options.limit,
    });
    returned = result.agents.length;
    rateLimit = result.rateLimit;
    for (const [index, raw] of result.agents.entries()) {
      try {
        const agent = provider.parseAgent(raw);
        if (
          agent.chain_id !== options.chainId ||
          agent.contract_address.toLowerCase() !==
            options.registryAddress.toLowerCase()
        )
          throw new Error(
            "Search result is outside the configured BSC registry",
          );
        const internalId = await corpusStore.persistAgent({
          agent,
          raw,
          fetchedAt: new Date(),
          derived: deriveScanAgent(agent),
        });
        const evidence = targetedCategoryEvidence(agent, options.category);
        await supplyStore.recordDiscovery({
          runId,
          agentId: internalId,
          sourceRecordId: agent.id,
          categorySlug: options.category,
          rank: index + 1,
          query,
          raw,
          confidence: evidence.confidence,
          matchedEvidence: { matched: evidence.matched },
        });
        accepted += 1;
      } catch {
        rejected += 1;
      }
    }
    await supplyStore.finishDiscoveryRun({
      runId,
      returned,
      accepted,
      rejected,
      rateLimit,
    });
    return { runId, category: options.category, returned, accepted, rejected };
  } catch (error) {
    await supplyStore.finishDiscoveryRun({
      runId,
      returned,
      accepted,
      rejected,
      rateLimit,
      error,
    });
    throw error;
  }
}

export function normalizedProtocolSupport(interfaceProtocol: string) {
  return {
    erc8183: interfaceProtocol === "erc8183",
    x402: interfaceProtocol === "x402",
    b402: interfaceProtocol === "b402",
    mcp: interfaceProtocol === "mcp",
    a2a: interfaceProtocol === "a2a",
  };
}

export function normalizeCuratedInterface(raw: string) {
  const normalized = normalizeServiceType(raw);
  if (/erc[-_\s]?8183|apex/i.test(raw)) return "erc8183";
  if (/\bb402\b/i.test(raw)) return "b402";
  return normalized;
}

export function verificationLevelRank(level: ServiceVerificationLevel) {
  return [
    "DECLARED",
    "ENDPOINT_OBSERVED",
    "SCHEMA_UNDERSTOOD",
    "PAYMENT_UNDERSTOOD",
    "INVOCATION_VERIFIED",
    "COMMERCE_VERIFIED",
  ].indexOf(level);
}
