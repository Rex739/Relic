import type { BlockEvidence, ScanBatch, ScannedEvent } from "@relic/blockchain";
import type { AgentRegistryProvider, RegistryAgentRecord } from "@relic/domain";
import { normalizeRegistryAgent } from "@relic/domain";
import { randomUUID } from "node:crypto";

import type { AgentWriter } from "./ingest.js";

export interface DurableCheckpoint {
  indexedBlock: bigint;
  indexedBlockHash: string | null;
  safeBlock: bigint;
}

export interface IndexerStore {
  checkpoint(): Promise<DurableCheckpoint | null>;
  recentBlocks(limit: number): Promise<BlockEvidence[]>;
  begin(
    runId: string,
    mode: string,
    fromBlock: bigint,
    safeBlock: bigint,
  ): Promise<void>;
  persistBatch(batch: ScanBatch, safeBlock: bigint): Promise<void>;
  rollbackFrom(block: bigint): Promise<string[]>;
  succeed(runId: string, counters: IndexerCounters): Promise<void>;
  fail(runId: string, error: unknown): Promise<void>;
}

export interface EventScanner {
  head(): Promise<bigint>;
  block(number: bigint): Promise<BlockEvidence>;
  scan(fromBlock: bigint, toBlock: bigint): AsyncGenerator<ScanBatch>;
}

export interface IndexerCounters {
  blocks: number;
  events: number;
  agents: number;
  inserted: number;
  updated: number;
  skipped: number;
  metadataFailures: number;
}

export interface IndexerRunOptions {
  mode: "backfill" | "sync";
  startBlock: bigint;
  confirmations: bigint;
  dryRun?: boolean;
  maxBlocks?: bigint;
  logger?: (entry: Record<string, unknown>) => void;
}

const emptyCounters = (): IndexerCounters => ({
  blocks: 0,
  events: 0,
  agents: 0,
  inserted: 0,
  updated: 0,
  skipped: 0,
  metadataFailures: 0,
});

function withEventContext(
  record: RegistryAgentRecord,
  event: ScannedEvent,
): RegistryAgentRecord {
  return {
    ...record,
    registrationTransaction:
      record.registrationTransaction ?? event.transactionHash,
    registrationBlock: record.registrationBlock ?? event.blockNumber.toString(),
    raw: { source: record.raw, indexEvent: event },
  };
}

export class RelicIndexer {
  constructor(
    private readonly scanner: EventScanner,
    private readonly provider: AgentRegistryProvider,
    private readonly writer: AgentWriter,
    private readonly store: IndexerStore,
  ) {}

  async run(options: IndexerRunOptions): Promise<IndexerCounters> {
    const runId = randomUUID();
    const counters = emptyCounters();
    const head = await this.scanner.head();
    const safeHead =
      head > options.confirmations ? head - options.confirmations : 0n;
    const checkpoint = await this.store.checkpoint();
    let fromBlock =
      options.mode === "backfill" || checkpoint === null
        ? options.startBlock
        : checkpoint.indexedBlock + 1n;

    if (checkpoint !== null && !options.dryRun) {
      const rollbackPoint = await this.#canonicalRollbackPoint(checkpoint);
      if (rollbackPoint !== null) {
        const affected = await this.store.rollbackFrom(rollbackPoint);
        fromBlock = rollbackPoint;
        for (const agentId of affected) {
          const record = await this.provider.getAgent(agentId);
          if (record !== null)
            await this.writer.persist(normalizeRegistryAgent(record), record);
        }
        options.logger?.({
          level: "warn",
          event: "reorg_detected",
          runId,
          rollbackFrom: rollbackPoint.toString(),
          affectedAgents: affected.length,
        });
      }
    }

    let toBlock = safeHead;
    if (
      options.maxBlocks !== undefined &&
      fromBlock + options.maxBlocks - 1n < toBlock
    )
      toBlock = fromBlock + options.maxBlocks - 1n;
    if (fromBlock > toBlock) return counters;

    if (!options.dryRun)
      await this.store.begin(runId, options.mode, fromBlock, safeHead);
    const started = Date.now();
    try {
      for await (const batch of this.scanner.scan(fromBlock, toBlock)) {
        counters.blocks += Number(batch.toBlock - batch.fromBlock + 1n);
        counters.events += batch.events.length;
        const latestByAgent = new Map<string, ScannedEvent>();
        for (const event of batch.events) {
          if (event.agentId !== null) latestByAgent.set(event.agentId, event);
        }
        counters.agents += latestByAgent.size;
        for (const [agentId, event] of latestByAgent) {
          const record = await this.provider.getAgent(agentId);
          if (record === null) {
            counters.skipped += 1;
            continue;
          }
          if (record.metadataResolution?.status === "failed")
            counters.metadataFailures += 1;
          if (!options.dryRun) {
            const contextualRecord = withEventContext(record, event);
            await this.writer.persist(
              normalizeRegistryAgent(contextualRecord),
              contextualRecord,
            );
          }
          counters.updated += 1;
        }
        if (!options.dryRun) await this.store.persistBatch(batch, safeHead);
        options.logger?.({
          level: "info",
          event: "indexer_batch",
          runId,
          chainId: batch.events[0]?.chainId,
          fromBlock: batch.fromBlock.toString(),
          toBlock: batch.toBlock.toString(),
          blockCount: Number(batch.toBlock - batch.fromBlock + 1n),
          eventCount: batch.events.length,
          agentCount: latestByAgent.size,
          checkpoint: options.dryRun ? null : batch.toBlock.toString(),
        });
      }
      if (!options.dryRun) await this.store.succeed(runId, counters);
      options.logger?.({
        level: "info",
        event: "indexer_complete",
        runId,
        ...counters,
        durationMs: Date.now() - started,
        safeBlock: safeHead.toString(),
        dryRun: options.dryRun ?? false,
      });
      return counters;
    } catch (error) {
      if (!options.dryRun) await this.store.fail(runId, error);
      throw error;
    }
  }

  async #canonicalRollbackPoint(
    checkpoint: DurableCheckpoint,
  ): Promise<bigint | null> {
    if (checkpoint.indexedBlockHash === null) return null;
    const current = await this.scanner.block(checkpoint.indexedBlock);
    if (
      current.hash.toLowerCase() === checkpoint.indexedBlockHash.toLowerCase()
    )
      return null;
    for (const stored of await this.store.recentBlocks(100)) {
      const canonical = await this.scanner.block(stored.number);
      if (canonical.hash.toLowerCase() === stored.hash.toLowerCase())
        return stored.number + 1n;
    }
    throw new Error(
      "Reorg exceeds retained block evidence; operator recovery required",
    );
  }
}
