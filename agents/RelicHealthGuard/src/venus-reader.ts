import { createPublicClient, http, type PublicClient } from "viem";
import { bsc } from "viem/chains";
import type { Address, HealthGuardConfig } from "./config.js";
import type { HealthGuardMandate, HealthObservation } from "./policy.js";

const erc20Abi = [
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;
const comptrollerAbi = [
  { type: "function", name: "getAssetsIn", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "address[]" }] },
  { type: "function", name: "markets", stateMutability: "view", inputs: [{ name: "vToken", type: "address" }], outputs: [{ name: "", type: "bool" }, { name: "", type: "uint256" }, { name: "", type: "bool" }] },
  { type: "function", name: "oracle", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
] as const;
const vTokenAbi = [
  { type: "function", name: "underlying", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "comptroller", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "getAccountSnapshot", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }, { name: "", type: "uint256" }, { name: "", type: "uint256" }, { name: "", type: "uint256" }] },
] as const;
const oracleAbi = [{ type: "function", name: "getUnderlyingPrice", stateMutability: "view", inputs: [{ name: "vToken", type: "address" }], outputs: [{ name: "", type: "uint256" }] }] as const;
const WAD = 10n ** 18n;
const sameAddress = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

export type VenusPublicClient = Pick<PublicClient, "getChainId" | "getCode" | "getBlock" | "readContract" | "getTransactionReceipt">;

/** Verifies the exact deployment values before a runtime can become ready. */
export async function verifyHealthGuardDeployment(config: HealthGuardConfig, client: VenusPublicClient): Promise<void> {
  if (await client.getChainId() !== config.chainId) throw new Error("Health Guard RPC is not connected to BSC Mainnet");
  const [usdtCode, vTokenCode, comptrollerCode, underlying, comptroller] = await Promise.all([
    client.getCode({ address: config.usdt }), client.getCode({ address: config.venusUsdtVToken }), client.getCode({ address: config.venusComptroller }),
    client.readContract({ address: config.venusUsdtVToken, abi: vTokenAbi, functionName: "underlying" }),
    client.readContract({ address: config.venusUsdtVToken, abi: vTokenAbi, functionName: "comptroller" }),
  ]);
  if ([usdtCode, vTokenCode, comptrollerCode].some((code) => code === "0x")) throw new Error("Health Guard configured Venus deployment has missing contract bytecode");
  if (!sameAddress(underlying, config.usdt)) throw new Error("Health Guard configured vToken does not use configured USDT");
  if (!sameAddress(comptroller, config.venusComptroller)) throw new Error("Health Guard configured vToken is bound to a different comptroller");
}

/**
 * Mainnet Core Pool health calculation from the protocol's own market
 * snapshots, collateral factors, and oracle prices, all at one block. This
 * intentionally rejects a market snapshot or price that cannot be read.
 */
export class VenusMainnetHealthReader {
  private readonly client: VenusPublicClient;
  public constructor(private readonly config: HealthGuardConfig, client?: VenusPublicClient) {
    this.client = client ?? createPublicClient({ chain: bsc, transport: http(config.rpcUrl) });
  }

  async observation(mandate: HealthGuardMandate): Promise<HealthObservation> {
    const block = await this.client.getBlock({ blockTag: "latest" });
    const blockNumber = block.number;
    if (blockNumber === null) throw new Error("Health Guard could not resolve a Mainnet block");
    const [assets, oracle, debtSnapshot, reserve] = await Promise.all([
      this.client.readContract({ address: this.config.venusComptroller, abi: comptrollerAbi, functionName: "getAssetsIn", args: [mandate.borrower], blockNumber }),
      this.client.readContract({ address: this.config.venusComptroller, abi: comptrollerAbi, functionName: "oracle", blockNumber }),
      this.client.readContract({ address: this.config.venusUsdtVToken, abi: vTokenAbi, functionName: "getAccountSnapshot", args: [mandate.borrower], blockNumber }),
      this.client.readContract({ address: this.config.usdt, abi: erc20Abi, functionName: "balanceOf", args: [mandate.rescueWallet], blockNumber }),
    ]);
    const [debtError, , debtBaseUnits] = debtSnapshot;
    if (debtError !== 0n) throw new Error(`Health Guard debt market snapshot failed with Venus code ${String(debtError)}`);
    if (debtBaseUnits === 0n) return { healthFactorWad: 2n ** 255n, outstandingDebtBaseUnits: 0n, rescueWalletUsdtBaseUnits: reserve, observedAt: new Date(Number(block.timestamp) * 1_000) };
    const debtPrice = await this.client.readContract({ address: oracle, abi: oracleAbi, functionName: "getUnderlyingPrice", args: [this.config.venusUsdtVToken], blockNumber });
    if (debtPrice === 0n) throw new Error("Health Guard Venus oracle returned no USDT price");
    let collateralValue = 0n;
    for (const asset of assets) {
      const [snapshot, market, price] = await Promise.all([
        this.client.readContract({ address: asset, abi: vTokenAbi, functionName: "getAccountSnapshot", args: [mandate.borrower], blockNumber }),
        this.client.readContract({ address: this.config.venusComptroller, abi: comptrollerAbi, functionName: "markets", args: [asset], blockNumber }),
        this.client.readContract({ address: oracle, abi: oracleAbi, functionName: "getUnderlyingPrice", args: [asset], blockNumber }),
      ]);
      const [error, vTokenBalance, , exchangeRate] = snapshot;
      const [, collateralFactor] = market;
      if (error !== 0n || price === 0n || collateralFactor === 0n) throw new Error("Health Guard could not verify collateral market evidence");
      const underlying = (vTokenBalance * exchangeRate) / WAD;
      collateralValue += (((underlying * price) / WAD) * collateralFactor) / WAD;
    }
    const debtValue = (debtBaseUnits * debtPrice) / WAD;
    if (debtValue === 0n) throw new Error("Health Guard calculated an invalid debt value");
    return {
      healthFactorWad: (collateralValue * WAD) / debtValue,
      outstandingDebtBaseUnits: debtBaseUnits,
      rescueWalletUsdtBaseUnits: reserve,
      observedAt: new Date(Number(block.timestamp) * 1_000),
    };
  }

  allowance(owner: Address): Promise<bigint> {
    return this.client.readContract({ address: this.config.usdt, abi: erc20Abi, functionName: "allowance", args: [owner, this.config.venusUsdtVToken] });
  }

  async confirm(hash: `0x${string}`): Promise<{ confirmed: boolean; detail?: string }> {
    const receipt = await this.client.getTransactionReceipt({ hash });
    return receipt.status === "success" ? { confirmed: true } : { confirmed: false, detail: "transaction reverted on BSC Mainnet" };
  }
}
