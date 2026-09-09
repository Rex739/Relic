import type { ServerEnvironment } from "@relic/config";
import type { Address } from "viem";

export type CommerceChainId = 56 | 97;

export type CommerceNetworkConfig = Readonly<{
  chainId: CommerceChainId;
  label: "BSC Testnet" | "BSC Mainnet · real funds";
  rpcUrl: string;
  erc8004Registry: Address;
  commerceAddress: Address;
  evaluatorAddress: Address;
  optimisticPolicyAddress: Address;
  explorerUrl: string;
  paymentTokenAddress: Address;
  paymentTokenDecimals: number;
  paymentTokenSymbol: "U";
  mainnetEnabled: boolean;
  enabledAgentIds: readonly string[];
  maximumJobAmountBaseUnits?: bigint;
}>;

export type CommerceNetworkRegistry = Readonly<
  Partial<Record<CommerceChainId, CommerceNetworkConfig>>
>;

const testnetRegistry = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as Address;
const testnetPaymentToken = "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565" as Address;

/**
 * The only place the API assembles its commerce networks. Testnet retains the
 * existing environment names; Mainnet has distinct names and is omitted
 * unless every required value is present. Callers must therefore fail closed
 * rather than silently using Testnet addresses on Mainnet.
 */
export function commerceNetworkConfig(
  environment: ServerEnvironment,
): CommerceNetworkRegistry {
  const registry: Partial<Record<CommerceChainId, CommerceNetworkConfig>> = {};
  if (
    environment.RELIC_ERC8183_COMMERCE_ADDRESS !== undefined &&
    environment.RELIC_ERC8183_EVALUATOR_ADDRESS !== undefined &&
    environment.ERC8183_POLICY_ADDRESS !== undefined
  )
    registry[97] = {
      chainId: 97,
      label: "BSC Testnet",
      rpcUrl: environment.BSC_TESTNET_RPC_URL,
      erc8004Registry: testnetRegistry,
      commerceAddress: environment.RELIC_ERC8183_COMMERCE_ADDRESS as Address,
      evaluatorAddress: environment.RELIC_ERC8183_EVALUATOR_ADDRESS as Address,
      optimisticPolicyAddress: environment.ERC8183_POLICY_ADDRESS as Address,
      explorerUrl: "https://testnet.bscscan.com",
      paymentTokenAddress: testnetPaymentToken,
      paymentTokenDecimals: 18,
      paymentTokenSymbol: "U",
      mainnetEnabled: false,
      enabledAgentIds: [],
    };

  const mainnetValues = [
    environment.RELIC_MAINNET_ERC8004_REGISTRY_ADDRESS,
    environment.RELIC_MAINNET_ERC8183_COMMERCE_ADDRESS,
    environment.RELIC_MAINNET_ERC8183_EVALUATOR_ADDRESS,
    environment.RELIC_MAINNET_ERC8183_POLICY_ADDRESS,
    environment.RELIC_MAINNET_PAYMENT_TOKEN_ADDRESS,
    environment.RELIC_MAINNET_PAYMENT_TOKEN_DECIMALS,
  ];
  if (
    environment.RELIC_MAINNET_COMMERCE_ENABLED === "true" &&
    !mainnetValues.every((value) => value !== undefined)
  )
    throw new Error(
      "BSC Mainnet commerce is enabled but its registry, ERC-8183 contracts, canonical $U token, or decimals are missing",
    );
  if (mainnetValues.every((value) => value !== undefined))
    registry[56] = {
      chainId: 56,
      label: "BSC Mainnet · real funds",
      rpcUrl: environment.BSC_MAINNET_RPC_URL,
      erc8004Registry: environment.RELIC_MAINNET_ERC8004_REGISTRY_ADDRESS as Address,
      commerceAddress: environment.RELIC_MAINNET_ERC8183_COMMERCE_ADDRESS as Address,
      evaluatorAddress: environment.RELIC_MAINNET_ERC8183_EVALUATOR_ADDRESS as Address,
      optimisticPolicyAddress: environment.RELIC_MAINNET_ERC8183_POLICY_ADDRESS as Address,
      explorerUrl: "https://bscscan.com",
      paymentTokenAddress: environment.RELIC_MAINNET_PAYMENT_TOKEN_ADDRESS as Address,
      paymentTokenDecimals: Number(environment.RELIC_MAINNET_PAYMENT_TOKEN_DECIMALS),
      paymentTokenSymbol: "U",
      mainnetEnabled: environment.RELIC_MAINNET_COMMERCE_ENABLED === "true",
      enabledAgentIds: environment.RELIC_MAINNET_ENABLED_AGENT_IDS?.split(",").map((id) => id.trim()).filter(Boolean) ?? [],
      ...(environment.RELIC_MAINNET_MAX_JOB_AMOUNT_BASE_UNITS === undefined
        ? {}
        : { maximumJobAmountBaseUnits: BigInt(environment.RELIC_MAINNET_MAX_JOB_AMOUNT_BASE_UNITS) }),
    };
  return registry;
}
