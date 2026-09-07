import {
  BSC_TESTNET_CHAIN_ID,
  type Address,
  type VenusTestnetConfig,
} from "./networkConfig.js";

export type YieldOperation = "approve" | "supply" | "withdraw";

export type YieldMandate = Readonly<{
  jobId: string;
  account: Address;
  expiresAt: Date;
  maximumAmountBaseUnits: bigint;
  minimumSecondsBetweenExecutions: number;
  lastExecutionAt?: Date;
}>;

export type YieldIntent = Readonly<{
  operation: YieldOperation;
  chainId: number;
  account: Address;
  target: Address;
  asset?: Address;
  spender?: Address;
  amountBaseUnits: bigint;
  deadline: Date;
}>;

const sameAddress = (left: string, right: string) =>
  left.toLowerCase() === right.toLowerCase();

const deny = (message: string): never => {
  throw new Error(`Yield execution denied: ${message}`);
};

/**
 * This is the last boundary before calldata construction or signing. It takes
 * structured intents only: raw calldata is intentionally not accepted.
 */
export function validateYieldIntent(
  config: VenusTestnetConfig,
  mandate: YieldMandate,
  intent: YieldIntent,
  now = new Date(),
): void {
  if (intent.chainId !== BSC_TESTNET_CHAIN_ID) deny("wrong network");
  if (now >= mandate.expiresAt || intent.deadline <= now || intent.deadline > mandate.expiresAt)
    deny("intent is outside the mandate window");
  if (!sameAddress(intent.account, mandate.account)) deny("intent account differs from buyer mandate");
  if (intent.amountBaseUnits <= 0n) deny("amount must be positive");
  if (intent.amountBaseUnits > mandate.maximumAmountBaseUnits)
    deny("amount exceeds buyer mandate");
  if (intent.amountBaseUnits > config.maxJobAmountBaseUnits)
    deny("amount exceeds service safety cap");
  if (
    mandate.lastExecutionAt &&
    now.getTime() - mandate.lastExecutionAt.getTime() < mandate.minimumSecondsBetweenExecutions * 1_000
  ) {
    deny("cooldown has not elapsed");
  }

  if (intent.operation === "approve") {
    if (!sameAddress(intent.target, config.usdt)) deny("approval target is not approved USDT");
    if (!intent.spender || !sameAddress(intent.spender, config.venusUsdtVToken))
      deny("approval spender is not the approved Venus market");
    return;
  }

  if (!sameAddress(intent.target, config.venusUsdtVToken))
    deny("target is not the approved Venus USDT market");
  if (intent.asset && !sameAddress(intent.asset, config.usdt)) deny("asset is not approved USDT");
}
