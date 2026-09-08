import { createPublicClient, getAddress, http, parseUnits, type Address } from "viem";
import { privateKeyToAccount, generatePrivateKey } from "viem/accounts";
import { bsc, bscTestnet } from "viem/chains";

import type {
  AltanaSessionAuthorizationRecord,
  DrizzleAltanaSessionAuthorizationStore,
} from "@relic/database";
import { MandateValidationError } from "@relic/domain";

import { AltanaSessionEncryption } from "./altana-session-encryption.js";
import type { MandateApplicationService } from "./mandates.js";

const positionManager = "0x427bF5b37357632377eCbEC9de3626C71A5396c1" as const;
const swapRouter = "0x9a489505a00cE272eAa5e07Dba6491314CaE3796" as const;
const testUsdt = "0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565" as const;
const wbnb = "0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd" as const;
const pancakeV3Factory = "0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865" as const;
const Q192 = 2n ** 192n;

const positionAbi = [
  {
    type: "function",
    name: "positions",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [
      { name: "nonce", type: "uint96" },
      { name: "operator", type: "address" },
      { name: "token0", type: "address" },
      { name: "token1", type: "address" },
      { name: "fee", type: "uint24" },
      { name: "tickLower", type: "int24" },
      { name: "tickUpper", type: "int24" },
      { name: "liquidity", type: "uint128" },
      { name: "feeGrowthInside0LastX128", type: "uint256" },
      { name: "feeGrowthInside1LastX128", type: "uint256" },
      { name: "tokensOwed0", type: "uint128" },
      { name: "tokensOwed1", type: "uint128" },
    ],
  },
] as const;

const factoryAbi = [
  {
    type: "function",
    name: "getPool",
    stateMutability: "view",
    inputs: [
      { name: "tokenA", type: "address" },
      { name: "tokenB", type: "address" },
      { name: "fee", type: "uint24" },
    ],
    outputs: [{ name: "pool", type: "address" }],
  },
] as const;

const poolAbi = [
  {
    type: "function",
    name: "slot0",
    stateMutability: "view",
    inputs: [],
    outputs: [
      { name: "sqrtPriceX96", type: "uint160" },
      { name: "tick", type: "int24" },
      { name: "observationIndex", type: "uint16" },
      { name: "observationCardinality", type: "uint16" },
      { name: "observationCardinalityNext", type: "uint16" },
      { name: "feeProtocol", type: "uint32" },
      { name: "unlocked", type: "bool" },
    ],
  },
] as const;

const accountKeysAbi = [
  {
    type: "function",
    name: "getKeys",
    stateMutability: "view",
    inputs: [],
    outputs: [
      {
        name: "keys",
        type: "tuple[]",
        components: [
          { name: "expiry", type: "uint40" },
          { name: "keyType", type: "uint8" },
          { name: "isSuperAdmin", type: "bool" },
          { name: "publicKey", type: "bytes" },
        ],
      },
      { name: "keyHashes", type: "bytes32[]" },
    ],
  },
] as const;

type PermissionSnapshot = {
  calls: Array<{ to: Address }>;
  spend: Array<{ token: Address; limit: string; period: "day" }>;
};

type YieldSessionConfig = Readonly<{
  usdt: Address;
  venusUsdtVToken: Address;
  maximumJobAmountBaseUnits: bigint;
}>;
type HealthGuardSessionConfig = Readonly<{ usdt: Address; venusUsdtVToken: Address }>;

const asText = (value: unknown) => (typeof value === "string" ? value : null);

function rebalancerSettings(riskConstraints: Record<string, unknown>) {
  const positionTokenId = asText(riskConstraints.positionTokenId);
  const capitalCap = asText(riskConstraints.capitalCap);
  const durationHours = riskConstraints.durationHours;
  if (
    positionTokenId === null ||
    capitalCap === null ||
    typeof durationHours !== "number" ||
    !Number.isInteger(durationHours) ||
    durationHours < 1
  )
    return null;
  return { positionTokenId, capitalCap, durationHours };
}

function yieldSettings(riskConstraints: Record<string, unknown>) {
  const maximumAmountBaseUnits = asText(riskConstraints.maximumAmountBaseUnits);
  const executionAmountBaseUnits = asText(riskConstraints.executionAmountBaseUnits);
  const maximumFeeWei = asText(riskConstraints.maximumFeeWei);
  const durationHours = riskConstraints.sessionDurationHours;
  if (
    riskConstraints.executionKind !== "VENUS_CORE_SUPPLY_WITHDRAW_V1" ||
    maximumAmountBaseUnits === null || !/^[1-9]\d*$/u.test(maximumAmountBaseUnits) ||
    executionAmountBaseUnits === null || !/^[1-9]\d*$/u.test(executionAmountBaseUnits) ||
    maximumFeeWei === null || !/^[1-9]\d*$/u.test(maximumFeeWei) ||
    typeof durationHours !== "number" || !Number.isInteger(durationHours) || durationHours < 1 || durationHours > 168 ||
    BigInt(executionAmountBaseUnits) > BigInt(maximumAmountBaseUnits)
  ) return null;
  return { maximumAmountBaseUnits, durationHours };
}

function healthGuardSettings(riskConstraints: Record<string, unknown>) {
  const maximumRepayBaseUnits = asText(riskConstraints.maximumRepayBaseUnits);
  const aggregateRepayLimitBaseUnits = asText(riskConstraints.aggregateRepayLimitBaseUnits);
  const maximumFeeWei = asText(riskConstraints.maximumFeeWei);
  const durationHours = riskConstraints.sessionDurationHours;
  if (
    riskConstraints.executionKind !== "VENUS_USDT_HEALTH_GUARD_V1" ||
    maximumRepayBaseUnits === null || !/^[1-9]\d*$/u.test(maximumRepayBaseUnits) ||
    aggregateRepayLimitBaseUnits === null || !/^[1-9]\d*$/u.test(aggregateRepayLimitBaseUnits) ||
    maximumFeeWei === null || !/^[1-9]\d*$/u.test(maximumFeeWei) ||
    typeof durationHours !== "number" || !Number.isInteger(durationHours) || durationHours < 1 || durationHours > 720 ||
    BigInt(aggregateRepayLimitBaseUnits) < BigInt(maximumRepayBaseUnits)
  ) return null;
  return { maximumRepayBaseUnits, durationHours };
}

/**
 * Prepares and verifies a buyer-owned Altana session for one configured,
 * executable BNB Testnet mandate.
 * The buyer signs the grant in their wallet. Relic holds only the constrained
 * session key, encrypted at rest; it never receives the buyer's admin key.
 */
export class AltanaSessionAuthorizationService {
  public constructor(
    private readonly mandates: MandateApplicationService,
    private readonly store: DrizzleAltanaSessionAuthorizationStore,
    private readonly encryption: AltanaSessionEncryption,
    private readonly testnetRpcUrl: string,
    private readonly yieldConfig?: YieldSessionConfig,
    private readonly mainnetRpcUrl?: string,
    private readonly healthGuardConfig?: HealthGuardSessionConfig,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async prepare(principalId: string, mandateId: string) {
    const mandate = await this.mandates.get(principalId, mandateId);
    const rebalancer = rebalancerSettings(mandate.version.riskConstraints);
    const yieldOptimizer = yieldSettings(mandate.version.riskConstraints);
    const healthGuard = healthGuardSettings(mandate.version.riskConstraints);
    if (rebalancer === null && yieldOptimizer === null && healthGuard === null)
      throw new MandateValidationError(
        "altana_session_not_supported",
        "A buyer-owned Altana session is available only for a configured executable service.",
      );
    if (healthGuard === null && mandate.chainId !== 97)
      throw new MandateValidationError("altana_session_not_supported", "This executable service is configured for BNB Testnet only.");
    if (healthGuard !== null && mandate.chainId !== 56)
      throw new MandateValidationError("altana_session_not_supported", "Health Guard is configured for BSC Mainnet only.");
    if (yieldOptimizer !== null && this.yieldConfig === undefined)
      throw new MandateValidationError("altana_session_not_configured", "Yield Optimizer session configuration is unavailable.");
    if (
      yieldOptimizer !== null &&
      BigInt(yieldOptimizer.maximumAmountBaseUnits) > this.yieldConfig!.maximumJobAmountBaseUnits
    )
      throw new MandateValidationError(
        "altana_session_amount_exceeds_limit",
        "This Yield Optimizer mandate exceeds the currently verified testnet safety limit.",
      );
    if (healthGuard !== null && (this.mainnetRpcUrl === undefined || this.healthGuardConfig === undefined))
      throw new MandateValidationError("altana_session_not_configured", "Health Guard Mainnet session configuration is unavailable.");
    if (mandate.status !== "REVIEWED")
      throw new MandateValidationError(
        "altana_session_invalid_state",
        "Review the service settings before authorizing its bounded session.",
      );
    const purpose = healthGuard !== null ? "HEALTH_GUARD" : rebalancer === null ? "YIELD_OPTIMIZER" : "LP_REBALANCER";

    const existing = await this.store.find(mandateId, principalId);
    if (existing !== null && existing.status === "PENDING" && existing.expiresAt > this.now())
      return this.#public(existing, purpose);
    if (existing !== null)
      throw new MandateValidationError(
        "altana_session_replacement_required",
        "This order already has an authorization record. Revoke it before creating another session.",
      );

    const privateKey = generatePrivateKey();
    const account = privateKeyToAccount(privateKey);
    const expiresAt = new Date(
      Math.min(
        Date.parse(mandate.version.expiresAt),
        this.now().getTime() + (rebalancer?.durationHours ?? yieldOptimizer?.durationHours ?? healthGuard!.durationHours) * 3_600_000,
      ),
    );
    const permissions: PermissionSnapshot = healthGuard !== null
      ? this.#healthGuardPermissions(healthGuard, this.healthGuardConfig!)
      : rebalancer === null ? this.#yieldPermissions(yieldOptimizer!, this.yieldConfig!) : await this.#rebalancerPermissions(rebalancer);
    const created = await this.store.create({
      mandateId,
      principalId,
      chainId: healthGuard !== null ? 56 : 97,
      sessionAddress: account.address,
      sessionPublicKey: account.publicKey,
      encryptedSessionPrivateKey: this.encryption.encrypt(privateKey),
      permissions,
      expiresAt,
      status: "PENDING",
    });
    return this.#public(created, purpose);
  }

  public async confirm(input: {
    principalId: string;
    mandateId: string;
    walletAddress: string;
    transactionHash: string;
  }) {
    const record = await this.store.find(input.mandateId, input.principalId);
    if (record === null)
      throw new MandateValidationError("altana_session_missing", "Prepare the wallet permission first.");
    if (record.status === "GRANTED") {
      // A request can be retried after the on-chain grant succeeds but before
      // the mandate transition commits. Complete that transition rather than
      // leaving an already-authorized order stuck in REVIEWED.
      const mandate = await this.mandates.get(input.principalId, input.mandateId);
      if (mandate.status === "REVIEWED") {
        if (record.walletAddress === null || record.grantTransactionHash === null)
          throw new MandateValidationError(
            "altana_session_confirmation_failed",
            "The recorded wallet authorization is incomplete.",
          );
        await this.mandates.activateAfterWalletAuthorization(input.principalId, input.mandateId, {
          walletAddress: record.walletAddress,
          sessionPublicKey: record.sessionPublicKey,
          transactionHash: record.grantTransactionHash,
        });
      }
      return this.#public(record);
    }
    if (record.status !== "PENDING" || record.expiresAt <= this.now())
      throw new MandateValidationError("altana_session_expired", "This trading permission has expired. Create a new one.");
    const walletAddress = getAddress(input.walletAddress);
    const mandate = await this.mandates.get(input.principalId, input.mandateId);
    if (healthGuardSettings(mandate.version.riskConstraints) !== null) {
      const monitoredAccount = asText(mandate.version.riskConstraints.monitoredAccount);
      if (monitoredAccount === null || monitoredAccount.toLowerCase() !== walletAddress.toLowerCase())
        throw new MandateValidationError(
          "health_guard_rescue_wallet_mismatch",
          "Health Guard V1 requires the monitored Venus account and authorized rescue wallet to be the same buyer wallet.",
        );
    }
    const publicClient = createPublicClient({ chain: record.chainId === 56 ? bsc : bscTestnet, transport: http(record.chainId === 56 ? this.mainnetRpcUrl! : this.testnetRpcUrl) });
    const [keys] = await publicClient.readContract({
      address: walletAddress,
      abi: accountKeysAbi,
      functionName: "getKeys",
    });
    if (!keys.some((key) => key.publicKey.toLowerCase() === record.sessionPublicKey.toLowerCase()))
      throw new MandateValidationError(
        "altana_session_unverified",
        "Relic could not verify the granted session on-chain. Wait briefly and try again.",
      );
    const granted = await this.store.markGranted({
      mandateId: input.mandateId,
      principalId: input.principalId,
      walletAddress,
      transactionHash: input.transactionHash,
    });
    if (granted === null)
      throw new MandateValidationError("altana_session_confirmation_failed", "Could not record the wallet authorization.");
    await this.mandates.activateAfterWalletAuthorization(input.principalId, input.mandateId, {
      walletAddress,
      sessionPublicKey: granted.sessionPublicKey,
      transactionHash: input.transactionHash,
    });
    return this.#public(granted);
  }

  public async isGranted(principalId: string, mandateId: string) {
    const record = await this.store.find(mandateId, principalId);
    return record?.status === "GRANTED" && record.expiresAt > this.now();
  }

  /**
   * The buyer approves the exact session caps at setup. Derive the WBNB cap
   * from the NFT's live pool price so the session cannot receive an arbitrary
   * WBNB allowance disguised as a TEST_USDT capital limit. The 20% buffer
   * only absorbs short-lived price movement between authorization and a run.
   */
  async #boundedWbnbSpend(positionTokenId: string, capitalCap: string) {
    const client = createPublicClient({
      chain: bscTestnet,
      transport: http(this.testnetRpcUrl),
    });
    const [, , token0Value, token1Value, fee] = await client.readContract({
      address: positionManager,
      abi: positionAbi,
      functionName: "positions",
      args: [BigInt(positionTokenId)],
    });
    const token0 = getAddress(token0Value);
    const token1 = getAddress(token1Value);
    if (!((token0 === wbnb && token1 === testUsdt) || (token0 === testUsdt && token1 === wbnb)))
      throw new MandateValidationError(
        "altana_session_unsupported_position",
        "This rebalancer only supports a BSC Testnet WBNB/TEST_USDT PancakeSwap V3 position.",
      );
    const pool = await client.readContract({
      address: pancakeV3Factory,
      abi: factoryAbi,
      functionName: "getPool",
      args: [token0, token1, fee],
    });
    if (pool === "0x0000000000000000000000000000000000000000")
      throw new MandateValidationError(
        "altana_session_pool_missing",
        "Relic could not find the PancakeSwap V3 pool for this position.",
      );
    const [sqrtPriceX96] = await client.readContract({
      address: getAddress(pool),
      abi: poolAbi,
      functionName: "slot0",
    });
    if (sqrtPriceX96 === 0n)
      throw new MandateValidationError("altana_session_price_missing", "The LP pool has no usable live price.");
    const cap = parseUnits(capitalCap, 18);
    const square = sqrtPriceX96 * sqrtPriceX96;
    const rawWbnb = token0 === testUsdt
      ? (cap * square) / Q192
      : (cap * Q192) / square;
    return (rawWbnb * 12n) / 10n;
  }

  #yieldPermissions(settings: { maximumAmountBaseUnits: string }, config: YieldSessionConfig): PermissionSnapshot {
    return {
      calls: [{ to: config.usdt }, { to: config.venusUsdtVToken }],
      spend: [{ token: config.usdt, limit: settings.maximumAmountBaseUnits, period: "day" }],
    };
  }

  #healthGuardPermissions(settings: { maximumRepayBaseUnits: string }, config: HealthGuardSessionConfig): PermissionSnapshot {
    return {
      calls: [{ to: config.usdt }, { to: config.venusUsdtVToken }],
      spend: [{ token: config.usdt, limit: settings.maximumRepayBaseUnits, period: "day" }],
    };
  }

  async #rebalancerPermissions(settings: { positionTokenId: string; capitalCap: string }): Promise<PermissionSnapshot> {
    const wbnbLimit = await this.#boundedWbnbSpend(settings.positionTokenId, settings.capitalCap);
    return {
      calls: [{ to: positionManager }, { to: swapRouter }],
      spend: [
        { token: testUsdt, limit: parseUnits(settings.capitalCap, 18).toString(), period: "day" },
        { token: wbnb, limit: wbnbLimit.toString(), period: "day" },
      ],
    };
  }

  #public(
    record: AltanaSessionAuthorizationRecord,
    purpose?: "LP_REBALANCER" | "YIELD_OPTIMIZER" | "HEALTH_GUARD",
  ) {
    return {
      id: record.id,
      mandateId: record.mandateId,
      chainId: record.chainId,
      sessionAddress: record.sessionAddress,
      sessionPublicKey: record.sessionPublicKey,
      permissions: record.permissions,
      expiresAt: record.expiresAt.toISOString(),
      status: record.status,
      ...(purpose === undefined ? {} : { purpose }),
      ...(record.walletAddress === null ? {} : { walletAddress: record.walletAddress }),
      ...(record.grantTransactionHash === null ? {} : { transactionHash: record.grantTransactionHash }),
    };
  }
}
