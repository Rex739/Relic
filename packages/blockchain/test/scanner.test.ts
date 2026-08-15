import type { PublicClient } from "viem";
import { describe, expect, it, vi } from "vitest";

import { Erc8004EventScanner } from "../src/index.js";

const hash = (digit: string): `0x${string}` => `0x${digit.repeat(64)}`;

describe("bounded ERC-8004 event scanner", () => {
  it("reduces an RPC-rejected block window and completes deterministically", async () => {
    const calls: Array<[bigint, bigint]> = [];
    const getContractEvents = vi.fn(
      ({ fromBlock, toBlock }: { fromBlock: bigint; toBlock: bigint }) => {
        calls.push([fromBlock, toBlock]);
        if (toBlock - fromBlock + 1n > 2n)
          throw new Error("block range limit exceeded");
        return Promise.resolve([]);
      },
    );
    const client = {
      getContractEvents,
      getBlock: ({ blockNumber }: { blockNumber: bigint }) =>
        Promise.resolve({
          hash: hash("a"),
          parentHash: hash("b"),
          number: blockNumber,
        }),
      getBlockNumber: () => Promise.resolve(10n),
    } as unknown as PublicClient;
    const scanner = new Erc8004EventScanner({
      client,
      chainId: 56,
      registryAddress: `0x${"1".repeat(40)}`,
      batchSize: 8n,
      minBatchSize: 2n,
      maxRetries: 0,
    });
    const batches = [];
    for await (const item of scanner.scan(1n, 4n)) batches.push(item);
    expect(batches.map((item) => [item.fromBlock, item.toBlock])).toEqual([
      [1n, 2n],
      [3n, 4n],
    ]);
    expect(calls.some(([from, to]) => to - from + 1n === 4n)).toBe(true);
  });

  it("bounds transient retries", async () => {
    const getBlockNumber = vi
      .fn()
      .mockRejectedValue(new Error("temporary RPC failure"));
    const client = { getBlockNumber } as unknown as PublicClient;
    const scanner = new Erc8004EventScanner({
      client,
      chainId: 56,
      registryAddress: `0x${"1".repeat(40)}`,
      maxRetries: 2,
      retryBaseMs: 1,
    });
    await expect(scanner.head()).rejects.toThrow("temporary RPC failure");
    expect(getBlockNumber).toHaveBeenCalledTimes(3);
  });
});
