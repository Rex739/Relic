import type { BlockEvidence, ScanBatch } from "@relic/blockchain";
import { and, desc, eq, gte, inArray } from "drizzle-orm";

import type { RelicDatabase } from "./client.js";
import {
  agentIdentities,
  agents,
  indexedBlocks,
  indexerCheckpoints,
  indexerRuns,
  metadataHistory,
  ownershipHistory,
  rawChainEvents,
} from "./schema.js";

const cleanJson = (value: unknown): unknown => {
  const encoded = JSON.stringify(value, (_key, nested: unknown) =>
    typeof nested === "bigint" ? nested.toString() : nested,
  );
  return JSON.parse(encoded) as unknown;
};

interface StoredCounters {
  blocks: number;
  events: number;
  agents: number;
  inserted: number;
  updated: number;
  skipped: number;
  metadataFailures: number;
}

export class DrizzleIndexerStore {
  constructor(
    private readonly database: RelicDatabase,
    private readonly chainId: number,
    private readonly registryAddress: string,
  ) {}

  async checkpoint() {
    const [row] = await this.database
      .select()
      .from(indexerCheckpoints)
      .where(
        and(
          eq(indexerCheckpoints.chainId, this.chainId),
          eq(indexerCheckpoints.registryAddress, this.registryAddress),
        ),
      )
      .limit(1);
    return row === undefined
      ? null
      : {
          indexedBlock: row.indexedBlock,
          indexedBlockHash: row.indexedBlockHash,
          safeBlock: row.safeBlock,
        };
  }

  async recentBlocks(limit: number): Promise<BlockEvidence[]> {
    const rows = await this.database
      .select()
      .from(indexedBlocks)
      .where(
        and(
          eq(indexedBlocks.chainId, this.chainId),
          eq(indexedBlocks.registryAddress, this.registryAddress),
        ),
      )
      .orderBy(desc(indexedBlocks.blockNumber))
      .limit(limit);
    return rows.map((row) => ({
      number: row.blockNumber,
      hash: row.blockHash as `0x${string}`,
      parentHash: row.parentHash as `0x${string}`,
    }));
  }

  async begin(
    runId: string,
    mode: string,
    fromBlock: bigint,
    safeBlock: bigint,
  ) {
    await this.database.transaction(async (tx) => {
      await tx.insert(indexerRuns).values({
        id: runId,
        mode,
        chainId: this.chainId,
        registryAddress: this.registryAddress,
        fromBlock,
        safeBlock,
        status: "running",
        counters: {},
        startedAt: new Date(),
      });
      await tx
        .insert(indexerCheckpoints)
        .values({
          chainId: this.chainId,
          registryAddress: this.registryAddress,
          indexedBlock: fromBlock - 1n,
          safeBlock,
          status: "running",
        })
        .onConflictDoUpdate({
          target: [
            indexerCheckpoints.chainId,
            indexerCheckpoints.registryAddress,
          ],
          set: {
            status: "running",
            safeBlock,
            error: null,
            updatedAt: new Date(),
          },
        });
    });
  }

  async persistBatch(batch: ScanBatch, safeBlock: bigint) {
    await this.database.transaction(async (tx) => {
      if (batch.events.length > 0)
        await tx
          .insert(rawChainEvents)
          .values(
            batch.events.map((event) => ({
              chainId: event.chainId,
              contractAddress: event.contractAddress,
              eventName: event.eventName,
              blockNumber: event.blockNumber,
              blockHash: event.blockHash,
              transactionHash: event.transactionHash,
              transactionIndex: event.transactionIndex,
              logIndex: event.logIndex,
              externalAgentId: event.agentId,
              decodedPayload: cleanJson(event.payload),
            })),
          )
          .onConflictDoNothing();
      for (const event of batch.events) {
        if (event.eventName !== "Transfer" || event.agentId === null) continue;
        const [identity] = await tx
          .select({ agentId: agentIdentities.agentId })
          .from(agentIdentities)
          .where(
            and(
              eq(agentIdentities.chainId, this.chainId),
              eq(agentIdentities.registryAddress, this.registryAddress),
              eq(agentIdentities.externalAgentId, event.agentId),
            ),
          )
          .limit(1);
        if (identity === undefined) continue;
        const previousOwner =
          typeof event.payload.from === "string" ? event.payload.from : null;
        const ownerAddress =
          typeof event.payload.to === "string" ? event.payload.to : null;
        if (ownerAddress === null) continue;
        await tx
          .insert(ownershipHistory)
          .values({
            agentId: identity.agentId,
            previousOwner,
            ownerAddress,
            blockNumber: event.blockNumber,
            blockHash: event.blockHash,
            transactionHash: event.transactionHash,
            logIndex: event.logIndex,
          })
          .onConflictDoNothing();
      }
      await tx
        .insert(indexedBlocks)
        .values({
          chainId: this.chainId,
          registryAddress: this.registryAddress,
          blockNumber: batch.boundaryBlock.number,
          blockHash: batch.boundaryBlock.hash,
          parentHash: batch.boundaryBlock.parentHash,
        })
        .onConflictDoUpdate({
          target: [
            indexedBlocks.chainId,
            indexedBlocks.registryAddress,
            indexedBlocks.blockNumber,
          ],
          set: {
            blockHash: batch.boundaryBlock.hash,
            parentHash: batch.boundaryBlock.parentHash,
            indexedAt: new Date(),
          },
        });
      await tx
        .update(indexerCheckpoints)
        .set({
          indexedBlock: batch.toBlock,
          indexedBlockHash: batch.boundaryBlock.hash,
          safeBlock,
          status: "running",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(indexerCheckpoints.chainId, this.chainId),
            eq(indexerCheckpoints.registryAddress, this.registryAddress),
          ),
        );
    });
  }

  async rollbackFrom(block: bigint): Promise<string[]> {
    return this.database.transaction(async (tx) => {
      const affectedRows = await tx
        .select({ externalAgentId: rawChainEvents.externalAgentId })
        .from(rawChainEvents)
        .where(
          and(
            eq(rawChainEvents.chainId, this.chainId),
            eq(rawChainEvents.contractAddress, this.registryAddress),
            gte(rawChainEvents.blockNumber, block),
          ),
        );
      const affected = [
        ...new Set(affectedRows.flatMap((row) => row.externalAgentId ?? [])),
      ];
      const identities =
        affected.length === 0
          ? []
          : await tx
              .select({ internalId: agentIdentities.agentId })
              .from(agentIdentities)
              .where(
                and(
                  eq(agentIdentities.chainId, this.chainId),
                  eq(agentIdentities.registryAddress, this.registryAddress),
                  inArray(agentIdentities.externalAgentId, affected),
                ),
              );
      const internalIds = identities.map((row) => row.internalId);
      if (internalIds.length > 0) {
        await tx
          .delete(metadataHistory)
          .where(
            and(
              inArray(metadataHistory.agentId, internalIds),
              gte(metadataHistory.observedBlock, block),
            ),
          );
        await tx
          .delete(ownershipHistory)
          .where(
            and(
              inArray(ownershipHistory.agentId, internalIds),
              gte(ownershipHistory.blockNumber, block),
            ),
          );
      }
      const orphanAgents = await tx
        .select({ id: agentIdentities.agentId })
        .from(agentIdentities)
        .where(
          and(
            eq(agentIdentities.chainId, this.chainId),
            eq(agentIdentities.registryAddress, this.registryAddress),
            gte(agentIdentities.registrationBlock, block),
          ),
        );
      if (orphanAgents.length > 0)
        await tx.delete(agents).where(
          inArray(
            agents.id,
            orphanAgents.map((row) => row.id),
          ),
        );
      await tx
        .delete(rawChainEvents)
        .where(
          and(
            eq(rawChainEvents.chainId, this.chainId),
            eq(rawChainEvents.contractAddress, this.registryAddress),
            gte(rawChainEvents.blockNumber, block),
          ),
        );
      await tx
        .delete(indexedBlocks)
        .where(
          and(
            eq(indexedBlocks.chainId, this.chainId),
            eq(indexedBlocks.registryAddress, this.registryAddress),
            gte(indexedBlocks.blockNumber, block),
          ),
        );
      const previous = await tx
        .select()
        .from(indexedBlocks)
        .where(
          and(
            eq(indexedBlocks.chainId, this.chainId),
            eq(indexedBlocks.registryAddress, this.registryAddress),
          ),
        )
        .orderBy(desc(indexedBlocks.blockNumber))
        .limit(1);
      await tx
        .update(indexerCheckpoints)
        .set({
          indexedBlock: previous[0]?.blockNumber ?? block - 1n,
          indexedBlockHash: previous[0]?.blockHash ?? null,
          status: "idle",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(indexerCheckpoints.chainId, this.chainId),
            eq(indexerCheckpoints.registryAddress, this.registryAddress),
          ),
        );
      return affected;
    });
  }

  async succeed(runId: string, counters: StoredCounters) {
    const now = new Date();
    await this.database.transaction(async (tx) => {
      await tx
        .update(indexerRuns)
        .set({ status: "succeeded", counters, finishedAt: now })
        .where(eq(indexerRuns.id, runId));
      await tx
        .update(indexerCheckpoints)
        .set({ status: "succeeded", lastSuccessfulRunAt: now, updatedAt: now })
        .where(
          and(
            eq(indexerCheckpoints.chainId, this.chainId),
            eq(indexerCheckpoints.registryAddress, this.registryAddress),
          ),
        );
    });
  }

  async fail(runId: string, error: unknown) {
    const value = {
      message: error instanceof Error ? error.message : String(error),
    };
    await this.database.transaction(async (tx) => {
      await tx
        .update(indexerRuns)
        .set({ status: "failed", error: value, finishedAt: new Date() })
        .where(eq(indexerRuns.id, runId));
      await tx
        .update(indexerCheckpoints)
        .set({ status: "failed", error: value, updatedAt: new Date() })
        .where(
          and(
            eq(indexerCheckpoints.chainId, this.chainId),
            eq(indexerCheckpoints.registryAddress, this.registryAddress),
          ),
        );
    });
  }
}
