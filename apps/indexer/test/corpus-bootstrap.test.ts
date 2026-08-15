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
  startRun() {
    return Promise.resolve("01945b1e-7e80-7000-8000-000000000001");
  }
  persistAgent(input: Parameters<BootstrapStore["persistAgent"]>[0]) {
    this.sourceIds.add(input.agent.id);
    return Promise.resolve(input.agent.id);
  }
  recordMalformed() {
    this.rejected += 1;
    return Promise.resolve();
  }
  completePage(input: {
    page: number;
    counters: BootstrapCounters;
    advanceCheckpoint: boolean;
  }) {
    this.completedPages.push(input.page);
    if (input.advanceCheckpoint) this.nextPage = input.page + 1;
    return Promise.resolve();
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
        startPage: 1,
      });
    expect(store.sourceIds).toEqual(new Set(["scan-1"]));
    expect(store.nextPage).toBe(3);
  });

  it("refuses a page-size change during implicit resume", async () => {
    const provider = new Scan8004Provider({ fetch: vi.fn<typeof fetch>() });
    await expect(
      bootstrapCorpus(provider, new MemoryStore(), {
        chainId: 56,
        registryAddress: registry,
        pageSize: 1,
        maxPages: 1,
      }),
    ).rejects.toThrow("Resume page size must remain 2");
  });
});
