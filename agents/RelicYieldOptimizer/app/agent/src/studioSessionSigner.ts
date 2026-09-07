import { getWallet } from "@bnbagent/studio-runtime/wallet";
import { bscTestnet } from "viem/chains";
import { createPublicClient, encodeFunctionData, http, type PublicClient } from "viem";
import type { Address, VenusTestnetConfig } from "./networkConfig.js";
import type { PreparedTransaction, SessionTransactionSigner } from "./signerBoundary.js";

type StudioWallet = Readonly<{
  address: Address;
  kind: string;
  supports(capability: string): boolean;
  makeExecutor(context: { client: PublicClient }): {
    execute(intent: {
      call: NonNullable<PreparedTransaction["call"]>;
      value: bigint;
      gas: bigint;
      description: string;
    }): Promise<{
      transactionHash: `0x${string}`;
      status: number;
      receipt: { status: "success" | "reverted" } | null;
    }>;
  };
}>;

const sameAddress = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

/**
 * Adapts the Studio-loaded Altana session to the narrow signing boundary.
 * Raw calldata cannot reach the wallet: only calls attached by the fixed
 * Venus adapter are converted into SDK intents. This class has no admin-key
 * path and accepts only the BSC Testnet client built from deployment config.
 */
export class StudioSessionSigner implements SessionTransactionSigner {
  private readonly executor;

  public constructor(
    private readonly config: VenusTestnetConfig,
    private readonly wallet: StudioWallet,
    private readonly client: PublicClient,
  ) {
    if (wallet.kind !== "altana" || !wallet.supports("broadcast.self"))
      throw new Error("Yield signing denied: a bounded Altana execution wallet is required");
    this.executor = wallet.makeExecutor({ client });
  }

  async getAddress(): Promise<Address> {
    return this.wallet.address;
  }

  getChainId(): Promise<number> {
    return this.client.getChainId();
  }

  getNativeBalance(address: Address): Promise<bigint> {
    return this.client.getBalance({ address });
  }

  async simulate(transaction: PreparedTransaction): Promise<{ ok: boolean; reason?: string }> {
    try {
      await this.client.call({ account: this.wallet.address, to: transaction.to, data: transaction.data, value: transaction.value });
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "RPC call simulation failed" };
    }
  }

  async send(transaction: PreparedTransaction): Promise<`0x${string}`> {
    if (!transaction.call) throw new Error("Yield signing denied: raw calldata cannot be sent through Studio");
    if (!sameAddress(transaction.call.address, transaction.to))
      throw new Error("Yield signing denied: structured call target differs from prepared transaction");
    const encoded = encodeFunctionData({
      abi: transaction.call.abi,
      functionName: transaction.call.functionName as never,
      args: transaction.call.args as never,
    });
    if (encoded.toLowerCase() !== transaction.data.toLowerCase())
      throw new Error("Yield signing denied: structured call differs from prepared calldata");
    if (await this.client.getChainId() !== this.config.chainId)
      throw new Error("Yield signing denied: BSC Testnet RPC is on the wrong network");

    const gas = await this.client.estimateGas({
      account: this.wallet.address,
      to: transaction.to,
      data: transaction.data,
      value: transaction.value,
    });
    const gasPrice = await this.client.getGasPrice();
    if (gas * gasPrice > transaction.maximumFeeWei)
      throw new Error("Yield signing denied: estimated transaction fee exceeds the approved cap");

    const result = await this.executor.execute({
      call: transaction.call,
      value: transaction.value,
      gas,
      description: "Relic Yield Optimizer bounded Venus operation",
    });
    if (result.status !== 1 || result.receipt?.status === "reverted")
      throw new Error("Yield signing denied: Studio execution did not confirm successfully");
    return result.transactionHash;
  }
}

/** Create the production signer only after server startup loaded ALTANA_SESSION. */
export function loadStudioSessionSigner(config: VenusTestnetConfig): StudioSessionSigner {
  const wallet = getWallet() as unknown as StudioWallet;
  const client = createPublicClient({ chain: bscTestnet, transport: http(config.rpcUrl) });
  return new StudioSessionSigner(config, wallet, client);
}
