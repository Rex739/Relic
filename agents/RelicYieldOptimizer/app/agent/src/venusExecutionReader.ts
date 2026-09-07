import type { YieldMandate } from "./executionPolicy.js";
import type { VenusExecutionReader } from "./executionBridge.js";
import type { VenusTestnetConfig } from "./networkConfig.js";

export interface VenusExecutionRpc {
  getTokenAllowance(token: VenusTestnetConfig["usdt"], owner: YieldMandate["account"], spender: VenusTestnetConfig["venusUsdtVToken"]): Promise<bigint>;
  getTokenBalance(token: VenusTestnetConfig["usdt"] | VenusTestnetConfig["venusUsdtVToken"], account: YieldMandate["account"]): Promise<bigint>;
  getTransactionReceipt(transactionHash: `0x${string}`): Promise<{ confirmed: boolean; detail?: string }>;
}

/**
 * Read-only confirmation and reconciliation adapter. It cannot sign or send
 * transactions; it only observes the exact testnet contracts in the config.
 */
export class VenusOnchainExecutionReader implements VenusExecutionReader {
  public constructor(
    private readonly config: VenusTestnetConfig,
    private readonly rpc: VenusExecutionRpc,
  ) {}

  allowance(owner: YieldMandate["account"]): Promise<bigint> {
    return this.rpc.getTokenAllowance(this.config.usdt, owner, this.config.venusUsdtVToken);
  }

  async snapshot(owner: YieldMandate["account"]): Promise<{ usdt: bigint; vToken: bigint }> {
    const [usdt, vToken] = await Promise.all([
      this.rpc.getTokenBalance(this.config.usdt, owner),
      this.rpc.getTokenBalance(this.config.venusUsdtVToken, owner),
    ]);
    return { usdt, vToken };
  }

  confirm(transactionHash: `0x${string}`, _operation: "approval" | "supply" | "withdraw"): Promise<{ confirmed: boolean; detail?: string }> {
    return this.rpc.getTransactionReceipt(transactionHash);
  }
}
