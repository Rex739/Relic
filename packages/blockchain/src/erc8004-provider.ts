import type {
  AgentRegistryListOptions,
  AgentRegistryPage,
  AgentRegistryProvider,
  RegistryAgentRecord,
} from "@relic/domain";
import { createHash } from "node:crypto";
import {
  getAddress,
  type Address,
  type GetContractEventsReturnType,
  type PublicClient,
} from "viem";

import { erc8004IdentityRegistryAbi } from "./erc8004-abi.js";
import type { MetadataResolver } from "./metadata.js";

export interface Erc8004ProviderOptions {
  readonly client: PublicClient;
  readonly chainId: number;
  readonly registryAddress: Address;
  readonly metadataResolver: MetadataResolver;
  readonly startBlock: bigint;
  readonly blockRange?: bigint;
}

type RegistrationLog = GetContractEventsReturnType<
  typeof erc8004IdentityRegistryAbi,
  "Registered"
>[number];

export class Erc8004RegistryProvider implements AgentRegistryProvider {
  public readonly providerId: string;
  readonly #client: PublicClient;
  readonly #chainId: number;
  readonly #registryAddress: Address;
  readonly #metadataResolver: MetadataResolver;
  readonly #startBlock: bigint;
  readonly #blockRange: bigint;

  public constructor(options: Erc8004ProviderOptions) {
    this.#client = options.client;
    this.#chainId = options.chainId;
    this.#registryAddress = getAddress(options.registryAddress);
    this.#metadataResolver = options.metadataResolver;
    this.#startBlock = options.startBlock;
    this.#blockRange = options.blockRange ?? 2_000n;
    this.providerId = `erc-8004:eip155:${this.#chainId}:${this.#registryAddress}`;
  }

  public async getAgent(agentId: string): Promise<RegistryAgentRecord | null> {
    const tokenId = BigInt(agentId);
    try {
      const [ownerAddress, metadataUri] = await Promise.all([
        this.#client.readContract({
          address: this.#registryAddress,
          abi: erc8004IdentityRegistryAbi,
          functionName: "ownerOf",
          args: [tokenId],
        }),
        this.#client.readContract({
          address: this.#registryAddress,
          abi: erc8004IdentityRegistryAbi,
          functionName: "tokenURI",
          args: [tokenId],
        }),
      ]);
      return await this.#toRecord({
        agentId: tokenId,
        owner: ownerAddress,
        agentURI: metadataUri,
      });
    } catch (error) {
      if (
        error instanceof Error &&
        /nonexistent|not found|revert/i.test(error.message)
      )
        return null;
      throw error;
    }
  }

  public async listAgents(
    options: AgentRegistryListOptions,
  ): Promise<AgentRegistryPage> {
    const latestBlock = await this.#client.getBlockNumber();
    let fromBlock = options.cursor?.blockNumber ?? this.#startBlock;
    const records: RegistryAgentRecord[] = [];
    let finalLog: RegistrationLog | undefined;

    while (fromBlock <= latestBlock && records.length < options.limit) {
      const toBlock =
        fromBlock + this.#blockRange > latestBlock
          ? latestBlock
          : fromBlock + this.#blockRange;
      const logs = await this.#client.getContractEvents({
        address: this.#registryAddress,
        abi: erc8004IdentityRegistryAbi,
        eventName: "Registered",
        fromBlock,
        toBlock,
      });
      for (const log of logs) {
        if (
          options.cursor?.blockNumber === log.blockNumber &&
          log.logIndex <= (options.cursor.logIndex ?? -1)
        )
          continue;
        if (
          log.args.agentId === undefined ||
          log.args.owner === undefined ||
          log.args.agentURI === undefined
        )
          continue;
        records.push(
          await this.#toRecord(
            {
              agentId: log.args.agentId,
              owner: log.args.owner,
              agentURI: log.args.agentURI,
            },
            log,
          ),
        );
        finalLog = log;
        if (records.length === options.limit) break;
      }
      fromBlock = toBlock + 1n;
    }

    return {
      agents: records,
      nextCursor:
        finalLog === undefined ||
        finalLog.blockNumber === null ||
        finalLog.logIndex === null
          ? null
          : { blockNumber: finalLog.blockNumber, logIndex: finalLog.logIndex },
    };
  }

  async #toRecord(
    identity: { agentId: bigint; owner: Address; agentURI: string },
    log?: RegistrationLog,
  ): Promise<RegistryAgentRecord> {
    const fetchedAt = new Date().toISOString();
    let metadata: unknown = null;
    let metadataResolution: RegistryAgentRecord["metadataResolution"];
    if (identity.agentURI.trim() === "") {
      metadataResolution = { status: "empty" };
    } else {
      try {
        metadata = await this.#metadataResolver.resolve(identity.agentURI);
        metadataResolution = {
          status: "resolved",
          contentHash: createHash("sha256")
            .update(JSON.stringify(metadata))
            .digest("hex"),
        };
      } catch (error) {
        metadataResolution = {
          status: "failed",
          error:
            error instanceof Error ? error.message : "Unknown metadata error",
        };
      }
    }
    return {
      source: this.providerId,
      chainId: this.#chainId,
      registryAddress: this.#registryAddress,
      agentId: identity.agentId.toString(),
      ownerAddress: getAddress(identity.owner),
      metadataUri: identity.agentURI,
      metadata,
      metadataResolution,
      registrationTransaction: log?.transactionHash ?? null,
      registrationBlock: log?.blockNumber?.toString() ?? null,
      registeredAt: null,
      fetchedAt,
      raw: {
        identity: {
          agentId: identity.agentId.toString(),
          owner: identity.owner,
          agentURI: identity.agentURI,
        },
        log:
          log === undefined
            ? null
            : {
                blockNumber: log.blockNumber?.toString(),
                logIndex: log.logIndex,
                transactionHash: log.transactionHash,
              },
        metadata,
      },
    };
  }
}
