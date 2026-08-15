import { ERC8183Client, EVMWalletProvider } from "@bnbagent/sdk";
import type {
  CommerceProvider,
  CommerceTerms,
  Erc8183JobState,
  PreparedCommerceJob,
} from "@relic/domain";
import { erc8183JobState } from "@relic/domain";
import { getAddress } from "viem";

import { ERC8183_DEPLOYMENTS } from "./erc8183-commerce.js";

type SdkClient = Pick<
  ERC8183Client,
  | "createJob"
  | "registerJob"
  | "setBudget"
  | "fund"
  | "getJob"
  | "submit"
  | "settle"
  | "cancelOpen"
  | "claimRefund"
  | "paymentToken"
> & {
  router: { address: string };
  policy: { address: string; disputeWindow(): Promise<bigint> };
  commerce: { address: string };
};

export interface CommerceWriteEvidence {
  operation: string;
  transactionHash: `0x${string}`;
  jobId?: string;
}

export class SdkErc8183CommerceProvider implements CommerceProvider {
  readonly #evidence: CommerceWriteEvidence[] = [];

  constructor(
    private readonly client: SdkClient,
    private readonly providerAddress: `0x${string}`,
    private readonly sellerUrl: string,
  ) {}

  static async fromEncryptedKeystore(input: {
    password: string;
    walletsDir: string;
    walletAddress?: string;
    providerAddress: `0x${string}`;
    sellerUrl: string;
  }) {
    if (!input.password)
      throw new Error("A human-provided wallet password is required");
    if (
      !EVMWalletProvider.keystoreExists(input.walletAddress, input.walletsDir)
    )
      throw new Error(
        "Buyer encrypted keystore not found; refusing to auto-create a wallet",
      );
    const walletProvider = new EVMWalletProvider({
      password: input.password,
      walletsDir: input.walletsDir,
      ...(input.walletAddress === undefined
        ? {}
        : { address: input.walletAddress }),
    });
    const client = await ERC8183Client.create({
      walletProvider,
      network: "bsc-testnet",
    });
    return new SdkErc8183CommerceProvider(
      client,
      input.providerAddress,
      input.sellerUrl,
    );
  }

  drainEvidence() {
    return this.#evidence.splice(0);
  }

  routingAddresses() {
    return {
      commerce: getAddress(this.client.commerce.address),
      router: getAddress(this.client.router.address),
      policy: getAddress(this.client.policy.address),
    };
  }

  disputeWindow() {
    return this.client.policy.disputeWindow();
  }

  async inspectSeller() {
    const response = await fetch(new URL("erc8183/status", this.sellerUrl), {
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok)
      throw new Error(`Seller status returned HTTP ${response.status}`);
    const status = (await response.json()) as Record<string, unknown>;
    if (status.service_price !== "0")
      throw new Error("Seller is not zero-price");
    if (status.chain_id !== 97) throw new Error("Seller is not on BSC testnet");
    if (
      typeof status.agent_address !== "string" ||
      getAddress(status.agent_address) !== getAddress(this.providerAddress)
    )
      throw new Error(
        "Seller status provider does not match the indexed service",
      );
    return status;
  }

  async negotiate(input: Record<string, unknown>) {
    const response = await fetch(new URL("erc8183/negotiate", this.sellerUrl), {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(10_000),
    });
    const result = (await response.json()) as Record<string, unknown>;
    if (!response.ok)
      throw new Error(`Seller negotiation failed: HTTP ${response.status}`);
    return result;
  }

  async getServiceTerms(): Promise<CommerceTerms> {
    const paymentToken = await this.client.paymentToken();
    return {
      chainId: 97,
      commerceAddress: getAddress(this.client.commerce.address),
      paymentToken: getAddress(paymentToken),
      providerAddress: getAddress(this.providerAddress),
      budget: 0n,
      source: "service-status",
    };
  }

  prepareJob(input: PreparedCommerceJob) {
    if (input.budget !== 0n)
      throw new Error("Reference activation must remain zero-price");
    if (getAddress(input.provider) !== getAddress(this.providerAddress))
      throw new Error("Prepared provider does not match the indexed seller");
    if (getAddress(input.evaluator) !== getAddress(this.client.router.address))
      throw new Error(
        "Prepared evaluator must be the configured ERC-8183 router",
      );
    if (getAddress(input.hook) !== getAddress(this.client.router.address))
      throw new Error("Prepared hook must be the configured ERC-8183 router");
    return Promise.resolve(input);
  }

  async createJob(input: PreparedCommerceJob) {
    const result = await this.client.createJob({
      provider: input.provider,
      expiredAt: input.expiresAt,
      description: input.description,
      hook: input.hook,
    });
    if (result.jobId === null)
      throw new Error("ERC-8183 createJob receipt had no job ID");
    this.#evidence.push({
      operation: "createJob",
      transactionHash: result.transactionHash,
      jobId: result.jobId.toString(),
    });
    return result.jobId;
  }

  async registerJob(jobId: bigint) {
    const result = await this.client.registerJob(jobId);
    return this.#record("registerJob", result.transactionHash, jobId);
  }

  async setBudget(jobId: bigint, amount: bigint) {
    if (amount !== 0n)
      throw new Error("Reference activation must remain zero-price");
    const result = await this.client.setBudget(jobId, 0n);
    return this.#record("setBudget(0)", result.transactionHash, jobId);
  }

  async fundJob(jobId: bigint, expectedBudget: bigint) {
    if (expectedBudget !== 0n)
      throw new Error("Reference activation must remain zero-price");
    const result = await this.client.fund(jobId, 0n);
    return this.#record("fund(0)", result.transactionHash, jobId);
  }

  async getJob(jobId: bigint): Promise<{ id: bigint; state: Erc8183JobState }> {
    const job = await this.client.getJob(jobId);
    return { id: job.id, state: erc8183JobState(job.status) };
  }

  async refreshJob(jobId: bigint) {
    const job = await this.client.getJob(jobId);
    return {
      id: job.id,
      state: erc8183JobState(job.status),
      deliverable: job.deliverable,
      submittedAt: job.submittedAt,
    };
  }

  async submit(jobId: bigint, deliverable: `0x${string}`) {
    const result = await this.client.submit(jobId, deliverable, {
      deliverable_url: new URL(
        `erc8183/job/${jobId}/response`,
        this.sellerUrl,
      ).toString(),
    });
    return this.#record("submit", result.transactionHash, jobId);
  }

  async settle(jobId: bigint, evidence: `0x${string}`) {
    const result = await this.client.settle(jobId, evidence);
    return this.#record("settle", result.transactionHash, jobId);
  }

  async reject(jobId: bigint, reason: `0x${string}`) {
    const result = await this.client.cancelOpen(jobId, reason);
    return this.#record("reject", result.transactionHash, jobId);
  }

  async claimRefund(jobId: bigint) {
    const result = await this.client.claimRefund(jobId);
    return this.#record("claimRefund", result.transactionHash, jobId);
  }

  #record(operation: string, transactionHash: `0x${string}`, jobId: bigint) {
    this.#evidence.push({
      operation,
      transactionHash,
      jobId: jobId.toString(),
    });
    return transactionHash;
  }
}

export function assertPublishedSdkDeployment(client: SdkClient) {
  if (getAddress(client.commerce.address) !== ERC8183_DEPLOYMENTS[97].commerce)
    throw new Error(
      "SDK commerce deployment differs from Relic's verified deployment",
    );
}
