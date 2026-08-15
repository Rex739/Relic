import type { AgentRegistryProvider, RegistryAgentRecord } from "@relic/domain";
import {
  normalizeRegistryAgent,
  UpstreamAgentValidationError,
} from "@relic/domain";

export interface AgentWriter {
  persist(
    agent: ReturnType<typeof normalizeRegistryAgent>,
    raw: RegistryAgentRecord,
  ): Promise<string>;
  recordFailure(
    raw: RegistryAgentRecord,
    error: { message: string; issues?: readonly string[] },
  ): Promise<void>;
}

export interface IngestionResult {
  ingested: number;
  rejected: number;
  nextCursor: { blockNumber?: bigint; logIndex?: number } | null;
}

export async function ingestAgentPage(
  provider: AgentRegistryProvider,
  writer: AgentWriter,
  limit: number,
): Promise<IngestionResult> {
  const page = await provider.listAgents({ limit });
  let ingested = 0;
  let rejected = 0;
  for (const raw of page.agents) {
    try {
      const normalized = normalizeRegistryAgent(raw);
      await writer.persist(normalized, raw);
      ingested += 1;
    } catch (error) {
      rejected += 1;
      const failure =
        error instanceof UpstreamAgentValidationError
          ? { message: error.message, issues: error.issues }
          : {
              message:
                error instanceof Error
                  ? error.message
                  : "Unknown normalization failure",
            };
      await writer.recordFailure(raw, failure);
    }
  }
  return { ingested, rejected, nextCursor: page.nextCursor };
}
