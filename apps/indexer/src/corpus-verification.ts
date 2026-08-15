import type { AgentRegistryProvider, RegistryAgentRecord } from "@relic/domain";
import { normalizeRegistryAgent } from "@relic/domain";

import type { AgentWriter } from "./ingest.js";

export interface VerificationCandidate {
  agentId: string;
  externalAgentId: string;
  secondaryOwner: string;
  secondaryMetadataUri?: string | null;
  registryAddress: string;
}

export interface VerificationStore {
  verificationCandidates(limit: number): Promise<VerificationCandidate[]>;
  markPending(agentId: string): Promise<void>;
  recordVerification(input: {
    agentId: string;
    status: "verified" | "partial" | "failed";
    blockNumber: bigint | null;
    facts: Record<string, unknown>;
    mismatches: Record<string, unknown>;
    evidence: Record<string, unknown>;
    error?: unknown;
  }): Promise<void>;
}

export function verificationComparison(
  candidate: VerificationCandidate,
  direct: RegistryAgentRecord,
) {
  const mismatches: Record<string, unknown> = {};
  if (candidate.externalAgentId !== direct.agentId)
    mismatches.agentId = {
      secondary: candidate.externalAgentId,
      onchain: direct.agentId,
    };
  if (
    candidate.registryAddress.toLowerCase() !==
    direct.registryAddress.toLowerCase()
  )
    mismatches.registryAddress = {
      secondary: candidate.registryAddress,
      onchain: direct.registryAddress,
    };
  if (
    candidate.secondaryOwner.toLowerCase() !== direct.ownerAddress.toLowerCase()
  )
    mismatches.ownerAddress = {
      secondary: candidate.secondaryOwner,
      onchain: direct.ownerAddress,
    };
  if (
    candidate.secondaryMetadataUri != null &&
    candidate.secondaryMetadataUri !== direct.metadataUri
  )
    mismatches.metadataUri = {
      secondary: candidate.secondaryMetadataUri,
      onchain: direct.metadataUri,
    };
  return {
    facts: {
      registryAddress: direct.registryAddress,
      agentId: direct.agentId,
      ownerAddress: direct.ownerAddress,
      metadataUri: direct.metadataUri,
    },
    mismatches,
    status: Object.keys(mismatches).length === 0 ? "verified" : "partial",
  } as const;
}

export async function verifyCorpus(
  registry: AgentRegistryProvider,
  writer: AgentWriter,
  store: VerificationStore,
  options: {
    limit: number;
    blockNumber: bigint;
    logger?: (entry: Record<string, unknown>) => void;
  },
) {
  const counters = { attempted: 0, verified: 0, partial: 0, failed: 0 };
  for (const candidate of await store.verificationCandidates(options.limit)) {
    counters.attempted += 1;
    await store.markPending(candidate.agentId);
    try {
      const direct = await registry.getAgent(candidate.externalAgentId);
      if (direct === null) {
        counters.failed += 1;
        await store.recordVerification({
          agentId: candidate.agentId,
          status: "failed",
          blockNumber: options.blockNumber,
          facts: {},
          mismatches: { identity: { secondary: "present", onchain: "absent" } },
          evidence: {
            provenance: "onchain_verified",
            source: registry.providerId,
          },
          error: new Error("Agent was not found in the configured registry"),
        });
        continue;
      }
      const comparison = verificationComparison(candidate, direct);
      await writer.persist(
        normalizeRegistryAgent(direct, { id: candidate.agentId }),
        direct,
      );
      await store.recordVerification({
        agentId: candidate.agentId,
        status: comparison.status,
        blockNumber: options.blockNumber,
        facts: comparison.facts,
        mismatches: comparison.mismatches,
        evidence: {
          provenance: "onchain_verified",
          source: direct.source,
          fetchedAt: direct.fetchedAt,
        },
      });
      counters[comparison.status] += 1;
      options.logger?.({
        event: "corpus_agent_verified",
        externalAgentId: candidate.externalAgentId,
        status: comparison.status,
        mismatches: comparison.mismatches,
      });
    } catch (error) {
      counters.failed += 1;
      await store.recordVerification({
        agentId: candidate.agentId,
        status: "failed",
        blockNumber: options.blockNumber,
        facts: {},
        mismatches: {},
        evidence: {
          provenance: "onchain_verified",
          source: registry.providerId,
        },
        error,
      });
    }
  }
  return counters;
}
