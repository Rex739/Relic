import { createPublicClient, http, type Address, type PublicClient } from "viem";
import { bsc } from "viem/chains";
import { healthGuardPool, type HealthGuardPoolRegistry } from "./health-guard-pool-registry.js";

const WAD = 10n ** 18n;
const comptrollerAbi = [
  { type: "function", name: "getAssetsIn", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "address[]" }] },
  { type: "function", name: "markets", stateMutability: "view", inputs: [{ name: "vToken", type: "address" }], outputs: [{ name: "", type: "bool" }, { name: "", type: "uint256" }, { name: "", type: "bool" }] },
  { type: "function", name: "oracle", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
] as const;
const vTokenAbi = [{ type: "function", name: "getAccountSnapshot", stateMutability: "view", inputs: [{ name: "account", type: "address" }], outputs: [{ name: "", type: "uint256" }, { name: "", type: "uint256" }, { name: "", type: "uint256" }, { name: "", type: "uint256" }] }] as const;
const oracleAbi = [{ type: "function", name: "getUnderlyingPrice", stateMutability: "view", inputs: [{ name: "vToken", type: "address" }], outputs: [{ name: "", type: "uint256" }] }] as const;

export type HealthGuardPreflightConfig = Readonly<{ rpcUrl: string; pools: HealthGuardPoolRegistry }>;
export type HealthGuardPreflightResult = Readonly<{
  poolId: string;
  eligible: boolean;
  reason: "position_ready" | "no_usdt_debt" | "no_collateral";
  healthFactorWad: string | null;
  usdtDebtBaseUnits: string;
  collateralMarkets: readonly Address[];
  observedAt: string;
}>;

/** Read-only, Mainnet position check used before any buyer session is created. */
export class HealthGuardPreflight {
  private readonly client: Pick<PublicClient, "getBlock" | "readContract">;
  public constructor(private readonly config: HealthGuardPreflightConfig, client?: Pick<PublicClient, "getBlock" | "readContract">) {
    this.client = client ?? createPublicClient({ chain: bsc, transport: http(config.rpcUrl) });
  }

  async inspect(input: { poolId: unknown; borrower: Address }): Promise<HealthGuardPreflightResult> {
    const pool = healthGuardPool(this.config.pools, input.poolId);
    const block = await this.client.getBlock({ blockTag: "latest" });
    if (block.number === null) throw new Error("Could not resolve a BNB Chain block");
    const [assets, oracle, debtSnapshot] = await Promise.all([
      this.client.readContract({ address: pool.comptrollerAddress, abi: comptrollerAbi, functionName: "getAssetsIn", args: [input.borrower], blockNumber: block.number }),
      this.client.readContract({ address: pool.comptrollerAddress, abi: comptrollerAbi, functionName: "oracle", blockNumber: block.number }),
      this.client.readContract({ address: pool.debtVTokenAddress, abi: vTokenAbi, functionName: "getAccountSnapshot", args: [input.borrower], blockNumber: block.number }),
    ]);
    const [debtError, , debt] = debtSnapshot;
    if (debtError !== 0n) throw new Error("Venus could not read the selected debt market");
    const observedAt = new Date(Number(block.timestamp) * 1_000).toISOString();
    if (debt === 0n) return { poolId: pool.id, eligible: false, reason: "no_usdt_debt", healthFactorWad: null, usdtDebtBaseUnits: "0", collateralMarkets: assets, observedAt };
    if (assets.length === 0) return { poolId: pool.id, eligible: false, reason: "no_collateral", healthFactorWad: null, usdtDebtBaseUnits: debt.toString(), collateralMarkets: [], observedAt };
    const debtPrice = await this.client.readContract({ address: oracle, abi: oracleAbi, functionName: "getUnderlyingPrice", args: [pool.debtVTokenAddress], blockNumber: block.number });
    if (debtPrice === 0n) throw new Error("Venus returned no debt-asset oracle price");
    let collateralValue = 0n;
    const verifiedCollateralMarkets: Address[] = [];
    for (const asset of assets) {
      const [snapshot, market, price] = await Promise.all([
        this.client.readContract({ address: asset, abi: vTokenAbi, functionName: "getAccountSnapshot", args: [input.borrower], blockNumber: block.number }),
        this.client.readContract({ address: pool.comptrollerAddress, abi: comptrollerAbi, functionName: "markets", args: [asset], blockNumber: block.number }),
        this.client.readContract({ address: oracle, abi: oracleAbi, functionName: "getUnderlyingPrice", args: [asset], blockNumber: block.number }),
      ]);
      const [error, vTokenBalance, , exchangeRate] = snapshot;
      const [, collateralFactor] = market;
      if (error !== 0n || price === 0n || collateralFactor === 0n) continue;
      if (vTokenBalance === 0n || exchangeRate === 0n) continue;
      collateralValue += (((vTokenBalance * exchangeRate) / WAD * price) / WAD * collateralFactor) / WAD;
      verifiedCollateralMarkets.push(asset);
    }
    if (verifiedCollateralMarkets.length === 0 || collateralValue === 0n)
      return { poolId: pool.id, eligible: false, reason: "no_collateral", healthFactorWad: null, usdtDebtBaseUnits: debt.toString(), collateralMarkets: [], observedAt };
    const debtValue = (debt * debtPrice) / WAD;
    return { poolId: pool.id, eligible: true, reason: "position_ready", healthFactorWad: debtValue === 0n ? null : ((collateralValue * WAD) / debtValue).toString(), usdtDebtBaseUnits: debt.toString(), collateralMarkets: verifiedCollateralMarkets, observedAt };
  }
}
