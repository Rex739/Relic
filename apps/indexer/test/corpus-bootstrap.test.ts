import { Scan8004Provider } from "@relic/blockchain";
import { describe, expect, it, vi } from "vitest";

import {
  bootstrapCorpus,
  type BootstrapCounters,
  type BootstrapStore,
} from "../src/corpus-bootstrap.js";

const registry = `0x${"8".repeat(40)}`;
const valid = (id: string) => ({
  id: `scan-${id}`,
  token_id: id,
  chain_id: 56,
  contract_address: registry,
  owner_address: `0x${id.padStart(40, "0")}`,
  name: `Agent ${id}`,
  supported_protocols: [],
});
const response = (page: number, data: unknown[], hasMore: boolean) =>
  new Response(
    JSON.stringify({
      success: true,
      data,
      meta: { pagination: { page, limit: 2, total: 4, hasMore } },
    }),
    { status: 200 },
  );

class MemoryStore implements BootstrapStore {
  nextPage = 3;
  readonly sourceIds = new Set<string>();
  readonly completedPages: number[] = [];
  rejected = 0;
  checkpoint() {
    return Promise.resolve({ nextPage: this.nextPage, pageSize: 2 });
  }
  repageCheckpoint(input: Parameters<BootstrapStore["repageCheckpoint"]>[0]) {
    this.nextPage =
      Math.floor(
        ((input.previousNextPage - 1) * input.previousPageSize) /
          input.nextPageSize,
      ) + 1;
    return Promise.resolve({
      nextPage: this.nextPage,
      pageSize: input.nextPageSize,
    });
  }
  startRun() {
    return Promise.resolve("01945b1e-7e80-7000-8000-000000000001");
  }
  persistDiscoveryPage(
    input: Parameters<BootstrapStore["persistDiscoveryPage"]>[0],
  ) {
    input.records.forEach(({ agent }) => this.sourceIds.add(agent.id));
    this.rejected += input.malformed.length;
    return Promise.resolve({
      persisted: input.records.length,
      malformed: input.malformed.length,
      statements: 4,
      transactionCount: 1,
      durationMs: 1,
    });
  }
  persistAgent(input: Parameters<BootstrapStore["persistAgent"]>[0]) {
    this.sourceIds.add(input.agent.id);
    return Promise.resolve(input.agent.id);
  }
  completePage(input: {
    page: number;
    counters: BootstrapCounters;
    advanceCheckpoint: boolean;
  }) {
    this.completedPages.push(input.page);
    if (input.advanceCheckpoint) this.nextPage = input.page + 1;
    return Promise.resolve({
      statements: 2,
      transactionCount: 1,
      durationMs: 1,
    });
  }
  finishRun() {
    return Promise.resolve();
  }
}

describe("resumable corpus bootstrap", () => {
  it("starts from the stored page, tolerates malformed records, and checkpoints pages", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(response(3, [valid("3"), { broken: true }], true))
      .mockResolvedValueOnce(response(4, [valid("4")], false));
    const provider = new Scan8004Provider({ fetch: fetchMock });
    const store = new MemoryStore();
    const result = await bootstrapCorpus(provider, store, {
      chainId: 56,
      registryAddress: registry,
      pageSize: 2,
      maxPages: 2,
      requestBudget: 2,
    });
    expect(result).toMatchObject({
      startPage: 3,
      endPage: 4,
      pages: 2,
      imported: 2,
      rejected: 1,
      complete: true,
    });
    expect(store.completedPages).toEqual([3, 4]);
    expect(store.nextPage).toBe(5);
  });

  it("is idempotent at the source-record boundary on an explicit replay", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(() =>
        Promise.resolve(response(1, [valid("1")], false)),
      );
    const provider = new Scan8004Provider({ fetch: fetchMock });
    const store = new MemoryStore();
    for (let replay = 0; replay < 2; replay += 1)
      await bootstrapCorpus(provider, store, {
        chainId: 56,
        registryAddress: registry,
        pageSize: 2,
        maxPages: 1,
        requestBudget: 1,
        startPage: 1,
      });
    expect(store.sourceIds).toEqual(new Set(["scan-1"]));
    expect(store.nextPage).toBe(3);
  });

  it("changes page size with a safe overlap instead of creating a gap", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(5, [valid("5")], false));
    const store = new MemoryStore();
    const result = await bootstrapCorpus(
      new Scan8004Provider({ fetch: fetchMock }),
      store,
      {
        chainId: 56,
        registryAddress: registry,
        pageSize: 1,
        maxPages: 1,
        requestBudget: 1,
      },
    );
    expect(result.startPage).toBe(5);
    expect(store.nextPage).toBe(6);
  });

  it("fails closed before persistence when full mode does not observe Pro", async () => {
    const fetchMock = vi
      .fn<typeof fetch>()
      .mockResolvedValue(response(3, [valid("3")], false));
    const provider = new Scan8004Provider({
      apiKey: "non-pro-fixture-key",
      fetch: fetchMock,
      requestBudget: 1,
    });
    const store = new MemoryStore();
    await expect(
      bootstrapCorpus(provider, store, {
        chainId: 56,
        registryAddress: registry,
        pageSize: 2,
        maxPages: 1,
        requestBudget: 1,
        requirePro: true,
      }),
    ).rejects.toThrow(/requires an API key observed at the 8004scan Pro tier/);
    expect(store.sourceIds.size).toBe(0);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
