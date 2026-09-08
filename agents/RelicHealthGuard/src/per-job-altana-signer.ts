import { BNB, createClient, signerFromPrivateKey, type Session } from "@altananetwork/sdk";
import { createPublicClient, encodeFunctionData, getAddress, http, type PublicClient } from "viem";
import { bsc } from "viem/chains";
import type { Address, HealthGuardConfig } from "./config.js";
import type { FundedHealthGuardSession } from "./funded-session-client.js";
import type { BoundedSessionSigner } from "./signer.js";
import type { PreparedTransaction } from "./transaction.js";

type SessionPermissions = Readonly<{
  calls?: Array<{ to: string }>;
  spend?: Array<{ token?: string; limit: string; period: "day" }>;
}>;
const sameAddress = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

/** Buyer-isolated Mainnet signer. It has a scoped session key, never an admin key. */
export class PerJobAltanaHealthGuardSigner implements BoundedSessionSigner {
  private readonly client: PublicClient;
  private readonly altana = createClient({ chains: [BNB] });
  private readonly session: Session;

  public constructor(private readonly config: HealthGuardConfig, release: FundedHealthGuardSession, client?: PublicClient) {
    if (release.expiresAt <= new Date()) throw new Error("Health Guard signing denied: session has expired");
    this.session = {
      walletAddress: getAddress(release.walletAddress),
      signer: signerFromPrivateKey(release.sessionPrivateKey),
      publicKey: release.sessionPublicKey,
      permissions: parsePermissions(release.permissions, config),
      expiry: Math.floor(release.expiresAt.getTime() / 1_000),
    };
    this.client = client ?? createPublicClient({ chain: bsc, transport: http(config.rpcUrl) });
  }

  async getAddress(): Promise<Address> { return this.session.walletAddress as Address; }
  async getChainId(): Promise<number> { return this.client.getChainId(); }
  async getNativeBalance(address: Address): Promise<bigint> { return this.client.getBalance({ address }); }

  async simulate(transaction: PreparedTransaction): Promise<{ ok: boolean; reason?: string }> {
    try {
      await this.client.call({ account: this.session.walletAddress, to: transaction.to, data: transaction.data, value: transaction.value });
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "BSC Mainnet simulation failed" };
    }
  }

  async send(transaction: PreparedTransaction): Promise<`0x${string}`> {
    if (!transaction.call || !sameAddress(transaction.call.address, transaction.to))
      throw new Error("Health Guard signing denied: raw or mismatched calldata is forbidden");
    const encoded = encodeFunctionData({ abi: transaction.call.abi, functionName: transaction.call.functionName as never, args: transaction.call.args as never });
    if (encoded.toLowerCase() !== transaction.data.toLowerCase())
      throw new Error("Health Guard signing denied: structured call differs from calldata");
    if (await this.client.getChainId() !== this.config.chainId)
      throw new Error("Health Guard signing denied: RPC is not BSC Mainnet");
    const gas = await this.client.estimateGas({ account: this.session.walletAddress, to: transaction.to, data: transaction.data, value: transaction.value });
    if (gas * await this.client.getGasPrice() > transaction.maximumFeeWei)
      throw new Error("Health Guard signing denied: estimated fee exceeds buyer cap");
    const result = await this.altana.execute({ session: this.session, chainId: this.config.chainId, calls: { to: transaction.to, data: transaction.data, value: transaction.value } });
    if (result.status !== "CONFIRMED" || !result.transactionHash)
      throw new Error("Health Guard signing denied: Altana did not confirm the transaction");
    return result.transactionHash;
  }
}

function parsePermissions(value: Record<string, unknown>, config: HealthGuardConfig): Session["permissions"] {
  const raw = value as SessionPermissions;
  if (!Array.isArray(raw.calls) || !Array.isArray(raw.spend) || raw.calls.length === 0 || raw.spend.length === 0)
    throw new Error("Health Guard signing denied: missing bounded session permissions");
  return {
    calls: raw.calls.map(({ to }) => {
      if (typeof to !== "string" || (!sameAddress(to, config.usdt) && !sameAddress(to, config.venusUsdtVToken)))
        throw new Error("Health Guard signing denied: unexpected call target");
      return { to: getAddress(to) };
    }),
    spend: raw.spend.map(({ token, limit, period }) => {
      if (token === undefined || !sameAddress(token, config.usdt) || !/^\d+$/u.test(limit) || BigInt(limit) <= 0n || period !== "day")
        throw new Error("Health Guard signing denied: invalid USDT daily spend permission");
      return { token: getAddress(token), limit: BigInt(limit), period };
    }),
  };
}
