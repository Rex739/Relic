import type { Address, Hash, PublicClient } from "viem";
import { getAddress } from "viem";

import { erc8004IdentityRegistryAbi } from "./erc8004-abi.js";

export interface ScannedEvent {
  chainId: number;
  contractAddress: Address;
  eventName: string;
  blockNumber: bigint;
  blockHash: Hash;
  transactionHash: Hash;
  transactionIndex: number;
  logIndex: number;
  agentId: string | null;
  payload: Record<string, unknown>;
}

export interface BlockEvidence {
  number: bigint;
  hash: Hash;
  parentHash: Hash;
}

export interface ScanBatch {
  fromBlock: bigint;
  toBlock: bigint;
  events: ScannedEvent[];
  boundaryBlock: BlockEvidence;
}

export interface Erc8004ScannerOptions {
  client: PublicClient;
  chainId: number;
  registryAddress: Address;
  batchSize?: bigint;
  minBatchSize?: bigint;
  maxRetries?: number;
  retryBaseMs?: number;
}

const eventNames = [
  "Registered",
  "URIUpdated",
  "Transfer",
  "MetadataSet",
  "MetadataUpdate",
] as const;

interface RawDecodedLog {
  blockNumber: bigint | null;
  blockHash: Hash | null;
  transactionHash: Hash | null;
  transactionIndex: number | null;
  logIndex: number | null;
  eventName: string;
  args: unknown;
}

const jsonValue = (value: unknown): unknown => {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map(jsonValue);
  if (value !== null && typeof value === "object")
    return Object.fromEntries(
      Object.entries(value).map(([key, nested]) => [key, jsonValue(nested)]),
    );
  return value;
};

function isRangeError(error: unknown): boolean {
  return (
    error instanceof Error &&
    /range|too many|limit|response size|query returned more|block span/i.test(
      error.message,
    )
  );
}

export class Erc8004EventScanner {
  readonly #client: PublicClient;
  readonly #chainId: number;
  readonly #registryAddress: Address;
  readonly #batchSize: bigint;
  readonly #minBatchSize: bigint;
  readonly #maxRetries: number;
  readonly #retryBaseMs: number;

  constructor(options: Erc8004ScannerOptions) {
    this.#client = options.client;
    this.#chainId = options.chainId;
    this.#registryAddress = getAddress(options.registryAddress);
    this.#batchSize = options.batchSize ?? 2_000n;
    this.#minBatchSize = options.minBatchSize ?? 25n;
    this.#maxRetries = options.maxRetries ?? 3;
    this.#retryBaseMs = options.retryBaseMs ?? 250;
  }

  async head(): Promise<bigint> {
    return this.#retry(() => this.#client.getBlockNumber());
  }

  async block(number: bigint): Promise<BlockEvidence> {
    const block = await this.#retry(() =>
      this.#client.getBlock({ blockNumber: number }),
    );
    if (block.hash === null) throw new Error(`Block ${number} has no hash`);
    return { number, hash: block.hash, parentHash: block.parentHash };
  }

  async *scan(fromBlock: bigint, toBlock: bigint): AsyncGenerator<ScanBatch> {
    let cursor = fromBlock;
    let window = this.#batchSize;
    while (cursor <= toBlock) {
      const end =
        cursor + window - 1n > toBlock ? toBlock : cursor + window - 1n;
      try {
        const events = await this.#logs(cursor, end);
        yield {
          fromBlock: cursor,
          toBlock: end,
          events,
          boundaryBlock: await this.block(end),
        };
        cursor = end + 1n;
        if (window < this.#batchSize) window *= 2n;
        if (window > this.#batchSize) window = this.#batchSize;
      } catch (error) {
        if (isRangeError(error) && window > this.#minBatchSize) {
          window =
            window / 2n < this.#minBatchSize ? this.#minBatchSize : window / 2n;
          continue;
        }
        throw error;
      }
    }
  }

  async #logs(fromBlock: bigint, toBlock: bigint): Promise<ScannedEvent[]> {
    const groups = await Promise.all(
      eventNames.map(async (eventName) => {
        return this.#retry(
          async () =>
            (await this.#client.getContractEvents({
              address: this.#registryAddress,
              abi: erc8004IdentityRegistryAbi,
              eventName,
              fromBlock,
              toBlock,
            })) as unknown as RawDecodedLog[],
        );
      }),
    );
    return groups
      .flat()
      .filter(
        (log) =>
          log.blockNumber !== null &&
          log.blockHash !== null &&
          log.transactionHash !== null &&
          log.transactionIndex !== null &&
          log.logIndex !== null,
      )
      .map((log) => {
        const args = jsonValue(log.args) as Record<string, unknown>;
        const id = args.agentId ?? args.tokenId ?? args._tokenId;
        const agentId =
          typeof id === "string" ||
          typeof id === "number" ||
          typeof id === "bigint"
            ? String(id)
            : null;
        return {
          chainId: this.#chainId,
          contractAddress: this.#registryAddress,
          eventName: log.eventName,
          blockNumber: log.blockNumber!,
          blockHash: log.blockHash!,
          transactionHash: log.transactionHash!,
          transactionIndex: log.transactionIndex!,
          logIndex: log.logIndex!,
          agentId,
          payload: args,
        };
      })
      .sort((left, right) =>
        left.blockNumber === right.blockNumber
          ? left.logIndex - right.logIndex
          : left.blockNumber < right.blockNumber
            ? -1
            : 1,
      );
  }

  async #retry<T>(operation: () => Promise<T>): Promise<T> {
    let lastError: unknown;
    for (let attempt = 0; attempt <= this.#maxRetries; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt === this.#maxRetries || isRangeError(error)) break;
        await new Promise((resolve) =>
          setTimeout(resolve, this.#retryBaseMs * 2 ** attempt),
        );
      }
    }
    throw lastError;
  }
}
