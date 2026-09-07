import { BNB_TESTNET, createClient, signerFromPrivateKey, type Session } from "@altananetwork/sdk";
import { createPublicClient, encodeFunctionData, getAddress, http, type PublicClient } from "viem";
import { bscTestnet } from "viem/chains";
import type { FundedSessionRelease } from "./fundedSessionClient.js";
import type { Address, VenusTestnetConfig } from "./networkConfig.js";
import type { PreparedTransaction, SessionTransactionSigner } from "./signerBoundary.js";

type SessionPermissions = Readonly<{
  calls?: Array<{ to: string }>;
  spend?: Array<{ token?: string; limit: string; period: "minute" | "hour" | "day" | "week" | "month" | "year" }>;
}>;

const sameAddress = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

/**
 * Narrow signer for exactly one API-released Altana session. The session key
 * lives only in this instance's memory. Structured Venus calls are re-encoded
 * before relay submission, so a caller cannot smuggle arbitrary calldata.
 */
export class PerJobAltanaSigner implements SessionTransactionSigner {
  private readonly client: PublicClient;
  private readonly session: Session;
  private readonly altana = createClient({ chains: [BNB_TESTNET] });

  public constructor(private readonly config: VenusTestnetConfig, release: FundedSessionRelease, client?: PublicClient) {
    if (release.expiresAt.getTime() <= Date.now()) throw new Error("Yield signing denied: the funded session has expired");
    const permissions = parsePermissions(release.permissions, config);
    this.session = {
      walletAddress: getAddress(release.walletAddress),
      signer: signerFromPrivateKey(release.sessionPrivateKey),
      publicKey: release.sessionPublicKey,
      permissions,
      expiry: Math.floor(release.expiresAt.getTime() / 1_000),
    };
    this.client = client ?? createPublicClient({ chain: bscTestnet, transport: http(config.rpcUrl) });
  }

  async getAddress(): Promise<Address> { return this.session.walletAddress as Address; }
  async getChainId(): Promise<number> { return this.client.getChainId(); }
  async getNativeBalance(address: Address): Promise<bigint> { return this.client.getBalance({ address }); }

  async simulate(transaction: PreparedTransaction): Promise<{ ok: boolean; reason?: string }> {
    try {
      await this.client.call({ account: this.session.walletAddress, to: transaction.to, data: transaction.data, value: transaction.value });
      return { ok: true };
    } catch (error) {
      return { ok: false, reason: error instanceof Error ? error.message : "RPC call simulation failed" };
    }
  }

  async send(transaction: PreparedTransaction): Promise<`0x${string}`> {
    if (!transaction.call) throw new Error("Yield signing denied: raw calldata cannot be sent through Altana");
    if (!sameAddress(transaction.call.address, transaction.to)) throw new Error("Yield signing denied: structured call target differs from prepared transaction");
    const encoded = encodeFunctionData({ abi: transaction.call.abi, functionName: transaction.call.functionName as never, args: transaction.call.args as never });
    if (encoded.toLowerCase() !== transaction.data.toLowerCase()) throw new Error("Yield signing denied: structured call differs from prepared calldata");
    if (await this.client.getChainId() !== this.config.chainId) throw new Error("Yield signing denied: BSC Testnet RPC is on the wrong network");
    const gas = await this.client.estimateGas({ account: this.session.walletAddress, to: transaction.to, data: transaction.data, value: transaction.value });
    if (gas * await this.client.getGasPrice() > transaction.maximumFeeWei) throw new Error("Yield signing denied: estimated transaction fee exceeds the approved cap");
    const result = await this.altana.execute({ session: this.session, chainId: this.config.chainId, calls: { to: transaction.to, data: transaction.data, value: transaction.value } });
    if (result.status !== "CONFIRMED" || !result.transactionHash) throw new Error("Yield signing denied: Altana session execution did not confirm successfully");
    return result.transactionHash;
  }
}

function parsePermissions(value: Record<string, unknown>, config: VenusTestnetConfig): Session["permissions"] {
  const raw = value as SessionPermissions;
  if (!Array.isArray(raw.calls) || raw.calls.length === 0 || !Array.isArray(raw.spend) || raw.spend.length === 0)
    throw new Error("Yield signing denied: released session is missing bounded call and spend permissions");
  const calls = raw.calls.map(({ to }) => {
    if (typeof to !== "string" || !sameAddress(to, config.usdt) && !sameAddress(to, config.venusUsdtVToken))
      throw new Error("Yield signing denied: released session permits an unexpected call target");
    return { to: getAddress(to) };
  });
  const spend = raw.spend.map(({ token, limit, period }) => {
    if (token === undefined || !sameAddress(token, config.usdt) || typeof limit !== "string" || !/^\d+$/u.test(limit) || BigInt(limit) <= 0n || period !== "day")
      throw new Error("Yield signing denied: released session has invalid spend permissions");
    return { token: getAddress(token), limit: BigInt(limit), period };
  });
  return { calls, spend };
}
