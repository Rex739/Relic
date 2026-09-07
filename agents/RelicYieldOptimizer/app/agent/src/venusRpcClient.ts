import type { VenusReadClient } from "./deploymentVerifier.js";
import type { Address } from "./networkConfig.js";

type JsonRpcResponse = { jsonrpc: "2.0"; id: number; result?: unknown; error?: { message?: string } };
type FetchLike = typeof fetch;

const SELECTOR = {
  decimals: "0x313ce567",
  symbol: "0x95d89b41",
  balanceOf: "0x70a08231",
  allowance: "0xdd62ed3e",
  underlying: "0x6f307dc3",
  comptroller: "0x5fe3b567",
} as const;

function assertHex(value: unknown, label: string): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]*$/u.test(value))
    throw new Error(`Venus RPC returned invalid ${label}`);
  return value as `0x${string}`;
}

function decodeAddress(value: unknown, label: string): Address {
  const hex = assertHex(value, label).slice(2);
  if (hex.length < 40) throw new Error(`Venus RPC returned invalid ${label}`);
  return `0x${hex.slice(-40)}` as Address;
}

function decodeUint(value: unknown, label: string): bigint {
  const hex = assertHex(value, label);
  return BigInt(hex);
}

function addressArgument(address: Address): string {
  return address.slice(2).padStart(64, "0");
}

function twoAddressArguments(owner: Address, spender: Address): string {
  return `${addressArgument(owner)}${addressArgument(spender)}`;
}

function decodeString(value: unknown, label: string): string {
  const hex = assertHex(value, label).slice(2);
  if (hex.length < 64) throw new Error(`Venus RPC returned invalid ${label}`);
  // Most BEP-20s use bytes32 symbol(). Support the dynamic ABI string form too.
  const firstWord = BigInt(`0x${hex.slice(0, 64)}`);
  let payload: string;
  if (firstWord === 32n && hex.length >= 128) {
    const length = Number(BigInt(`0x${hex.slice(64, 128)}`));
    payload = hex.slice(128, 128 + length * 2);
  } else {
    payload = hex.slice(0, 64).replace(/(00)+$/u, "");
  }
  const output = Buffer.from(payload, "hex").toString("utf8").trim();
  if (!output) throw new Error(`Venus RPC returned empty ${label}`);
  return output;
}

/** Live, read-only JSON-RPC adapter. It has no signing capability. */
export class VenusJsonRpcClient implements VenusReadClient {
  private id = 0;

  constructor(
    private readonly rpcUrl: string,
    private readonly fetchImpl: FetchLike = fetch,
  ) {}

  private async request(method: string, params: unknown[]): Promise<unknown> {
    const response = await this.fetchImpl(this.rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++this.id, method, params }),
    });
    if (!response.ok) throw new Error(`Venus RPC HTTP ${String(response.status)}`);
    const body = await response.json() as JsonRpcResponse;
    if (body.error) throw new Error(`Venus RPC ${method} failed: ${body.error.message ?? "unknown error"}`);
    if (!("result" in body)) throw new Error(`Venus RPC ${method} returned no result`);
    return body.result;
  }

  private call(address: Address, data: string): Promise<unknown> {
    return this.request("eth_call", [{ to: address, data }, "latest"]);
  }

  async getChainId(): Promise<number> {
    return Number(decodeUint(await this.request("eth_chainId", []), "chain ID"));
  }

  getCode(address: Address): Promise<`0x${string}`> {
    return this.request("eth_getCode", [address, "latest"]).then((value) => assertHex(value, "code"));
  }

  async getTokenMetadata(address: Address): Promise<{ symbol: string; decimals: number }> {
    const [symbol, decimals] = await Promise.all([
      this.call(address, SELECTOR.symbol).then((value) => decodeString(value, "token symbol")),
      this.call(address, SELECTOR.decimals).then((value) => Number(decodeUint(value, "token decimals"))),
    ]);
    if (!Number.isInteger(decimals) || decimals < 0 || decimals > 36)
      throw new Error("Venus RPC returned unsupported token decimals");
    return { symbol, decimals };
  }

  getTokenBalance(token: Address, account: Address): Promise<bigint> {
    return this.call(token, `${SELECTOR.balanceOf}${addressArgument(account)}`).then((value) =>
      decodeUint(value, "token balance"),
    );
  }

  getTokenAllowance(token: Address, owner: Address, spender: Address): Promise<bigint> {
    return this.call(token, `${SELECTOR.allowance}${twoAddressArguments(owner, spender)}`).then((value) =>
      decodeUint(value, "token allowance"),
    );
  }

  async getTransactionReceipt(transactionHash: `0x${string}`): Promise<{ confirmed: boolean; detail?: string }> {
    if (!/^0x[0-9a-fA-F]{64}$/u.test(transactionHash)) throw new Error("Venus RPC received invalid transaction hash");
    const receipt = await this.request("eth_getTransactionReceipt", [transactionHash]);
    if (receipt === null) return { confirmed: false, detail: "transaction receipt is not available yet" };
    if (!receipt || typeof receipt !== "object") throw new Error("Venus RPC returned invalid transaction receipt");
    const status = (receipt as { status?: unknown }).status;
    if (status === "0x1") return { confirmed: true };
    if (status === "0x0") return { confirmed: false, detail: "transaction reverted on-chain" };
    throw new Error("Venus RPC returned transaction receipt without a valid status");
  }

  getVTokenUnderlying(vToken: Address): Promise<Address> {
    return this.call(vToken, SELECTOR.underlying).then((value) => decodeAddress(value, "vToken underlying"));
  }

  getVTokenComptroller(vToken: Address): Promise<Address> {
    return this.call(vToken, SELECTOR.comptroller).then((value) => decodeAddress(value, "vToken Comptroller"));
  }

}
