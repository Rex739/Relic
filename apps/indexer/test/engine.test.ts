/* eslint-disable @typescript-eslint/unbound-method */
import type { ScanBatch } from "@relic/blockchain";
import type { AgentRegistryProvider, RegistryAgentRecord } from "@relic/domain";
import { describe, expect, it, vi } from "vitest";

import type { EventScanner, IndexerStore } from "../src/engine.js";
import { RelicIndexer } from "../src/engine.js";
import type { AgentWriter } from "../src/ingest.js";

const hash = (digit: string): `0x${string}` => `0x${digit.repeat(64)}`;
const address: `0x${string}` = `0x${"1".repeat(40)}`;

const record: RegistryAgentRecord = {
  source: "erc-8004:eip155:56:test",
  chainId: 56,
  registryAddress: address,
  agentId: "1",
  ownerAddress: `0x${"2".repeat(40)}`,
  metadataUri: "data:application/json,%7B%22name%22%3A%22Fixture%22%7D",
  metadata: { name: "Fixture", services: [] },
  metadataResolution: { status: "resolved", contentHash: "abc" },
  registrationTransaction: hash("3"),
  registrationBlock: "100",
  registeredAt: null,
  fetchedAt: "2026-08-13T00:00:00.000Z",
  raw: {},
};

const batch = (fromBlock = 100n, toBlock = 101n): ScanBatch => ({
  fromBlock,
  toBlock,
  boundaryBlock: { number: toBlock, hash: hash("a"), parentHash: hash("b") },
  events: [
    {
      chainId: 56,
      contractAddress: address,
      eventName: "Registered",
      blockNumber: fromBlock,
      blockHash: hash("c"),
      transactionHash: hash("3"),
      transactionIndex: 0,
      logIndex: 0,
      agentId: "1",
      payload: { agentId: "1", owner: record.ownerAddress },
    },
  ],
});

function scannerFixture(
  options: { checkpointCanonical?: boolean } = {},
): EventScanner {
  return {
    head: () => Promise.resolve(120n),
    block: (number) =>
      Promise.resolve({
        number,
        hash:
          number === 99n || options.checkpointCanonical !== false
            ? hash("a")
            : hash("f"),
        parentHash: hash("b"),
      }),
    scan: (fromBlock, toBlock) =>
      (async function* () {
        await Promise.resolve();
        yield batch(fromBlock, toBlock);
      })(),
  };
}

function providerFixture(): AgentRegistryProvider {
  return {
    providerId: "fixture",
    getAgent: () => Promise.resolve(record),
    listAgents: () => Promise.resolve({ agents: [], nextCursor: null }),
  };
}

function storeFixture(
  checkpoint: Awaited<ReturnType<IndexerStore["checkpoint"]>> = null,
) {
  const persistBatch = vi
    .fn<IndexerStore["persistBatch"]>()
    .mockResolvedValue(undefined);
  const store: IndexerStore = {
    checkpoint: () => Promise.resolve(checkpoint),
    recentBlocks: () =>
      Promise.resolve([
        { number: 99n, hash: hash("a"), parentHash: hash("b") },
      ]),
    begin: vi.fn().mockResolvedValue(undefined),
    persistBatch,
    rollbackFrom: vi.fn().mockResolvedValue(["1"]),
    succeed: vi.fn().mockResolvedValue(undefined),
    fail: vi.fn().mockResolvedValue(undefined),
  };
  return { store, persistBatch };
}

function writerFixture(): AgentWriter {
  return {
    persist: vi.fn().mockResolvedValue("01945b1e-7e80-7000-8000-000000000001"),
    recordFailure: vi.fn().mockResolvedValue(undefined),
  };
}

describe("durable Relic indexer", () => {
  it("resumes after the persisted checkpoint and checkpoints only after persistence", async () => {
    const { store, persistBatch } = storeFixture({
      indexedBlock: 99n,
      indexedBlockHash: hash("a"),
      safeBlock: 99n,
    });
    const writer = writerFixture();
    await new RelicIndexer(
      scannerFixture(),
      providerFixture(),
      writer,
      store,
    ).run({
      mode: "sync",
      startBlock: 1n,
      confirmations: 15n,
      maxBlocks: 2n,
    });
    expect(writer.persist).toHaveBeenCalledOnce();
    expect(persistBatch).toHaveBeenCalledOnce();
    expect(persistBatch.mock.calls[0]?.[0].fromBlock).toBe(100n);
  });

  it("does not advance the checkpoint when an agent transaction fails", async () => {
    const { store, persistBatch } = storeFixture();
    const writer = writerFixture();
    vi.mocked(writer.persist).mockRejectedValueOnce(
      new Error("database unavailable"),
    );
    await expect(
      new RelicIndexer(scannerFixture(), providerFixture(), writer, store).run({
        mode: "backfill",
        startBlock: 100n,
        confirmations: 15n,
        maxBlocks: 2n,
      }),
    ).rejects.toThrow("database unavailable");
    expect(persistBatch).not.toHaveBeenCalled();
    expect(store.fail).toHaveBeenCalledOnce();
  });

  it("detects a mismatched checkpoint hash, rolls back, and refreshes affected agents", async () => {
    const { store } = storeFixture({
      indexedBlock: 101n,
      indexedBlockHash: hash("a"),
      safeBlock: 101n,
    });
    const writer = writerFixture();
    await new RelicIndexer(
      scannerFixture({ checkpointCanonical: false }),
      providerFixture(),
      writer,
      store,
    ).run({ mode: "sync", startBlock: 1n, confirmations: 15n, maxBlocks: 1n });
    expect(store.rollbackFrom).toHaveBeenCalledWith(100n);
    expect(writer.persist).toHaveBeenCalledTimes(2);
  });

  it("reports a dry run without mutating normalized or checkpoint state", async () => {
    const { store, persistBatch } = storeFixture();
    const writer = writerFixture();
    const result = await new RelicIndexer(
      scannerFixture(),
      providerFixture(),
      writer,
      store,
    ).run({
      mode: "backfill",
      startBlock: 100n,
      confirmations: 15n,
      maxBlocks: 2n,
      dryRun: true,
    });
    expect(result.events).toBe(1);
    expect(writer.persist).not.toHaveBeenCalled();
    expect(persistBatch).not.toHaveBeenCalled();
    expect(store.begin).not.toHaveBeenCalled();
  });
});
