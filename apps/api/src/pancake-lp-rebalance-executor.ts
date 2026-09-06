import {
  BNB_TESTNET,
  createClient,
  signerFromPrivateKey,
  type Session,
} from "@altananetwork/sdk";
import type {
  AltanaSessionAuthorizationRecord,
  DrizzleAltanaSessionAuthorizationStore,
} from "@relic/database";
import type { ExecutionReceipt, ExecutionRecord } from "@relic/domain";
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  http,
  maxUint128,
  type Address,
  type Hex,
} from "viem";
import { z } from "zod";

import { AltanaSessionEncryption } from "./altana-session-encryption.js";

const chainId = 97;
const positionManager = getAddress(
  "0x427bF5b37357632377eCbEC9de3626C71A5396c1",
);
// Verified against the live BSC Testnet Position Manager on 2026-09-06.
const swapRouter = getAddress("0x9a489505a00cE272eAa5e07Dba6491314CaE3796");
const wbnb = getAddress("0xae13d989daC2f0dEbFf460aC112a837C89BAa7cd");
const testUsdt = getAddress("0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565");

const positionManagerAbi = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "owner", type: "address" }],
  },
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
  {
    type: "function",
    name: "multicall",
    stateMutability: "payable",
    inputs: [{ name: "data", type: "bytes[]" }],
    outputs: [{ name: "results", type: "bytes[]" }],
  },
  {
    type: "function",
    name: "decreaseLiquidity",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenId", type: "uint256" },
          { name: "liquidity", type: "uint128" },
          { name: "amount0Min", type: "uint256" },
          { name: "amount1Min", type: "uint256" },
          { name: "deadline", type: "uint256" },
        ],
      },
    ],
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "collect",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenId", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "amount0Max", type: "uint128" },
          { name: "amount1Max", type: "uint128" },
        ],
      },
    ],
    outputs: [
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "mint",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "token0", type: "address" },
          { name: "token1", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "tickLower", type: "int24" },
          { name: "tickUpper", type: "int24" },
          { name: "amount0Desired", type: "uint256" },
          { name: "amount1Desired", type: "uint256" },
          { name: "amount0Min", type: "uint256" },
          { name: "amount1Min", type: "uint256" },
          { name: "recipient", type: "address" },
          { name: "deadline", type: "uint256" },
        ],
      },
    ],
    outputs: [
      { name: "tokenId", type: "uint256" },
      { name: "liquidity", type: "uint128" },
      { name: "amount0", type: "uint256" },
      { name: "amount1", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "burn",
    stateMutability: "payable",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [],
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
  {
    type: "function",
    name: "tickSpacing",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "tickSpacing", type: "int24" }],
  },
] as const;

const erc20Abi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "balance", type: "uint256" }],
  },
  {
    type: "function",
    name: "allowance",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" },
    ],
    outputs: [{ name: "allowance", type: "uint256" }],
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

const swapRouterAbi = [
  {
    type: "function",
    name: "exactInputSingle",
    stateMutability: "payable",
    inputs: [
      {
        name: "params",
        type: "tuple",
        components: [
          { name: "tokenIn", type: "address" },
          { name: "tokenOut", type: "address" },
          { name: "fee", type: "uint24" },
          { name: "recipient", type: "address" },
          { name: "amountIn", type: "uint256" },
          { name: "amountOutMinimum", type: "uint256" },
          { name: "sqrtPriceLimitX96", type: "uint160" },
        ],
      },
    ],
    outputs: [{ name: "amountOut", type: "uint256" }],
  },
] as const;

const pancakeV3Factory = getAddress("0x0BFbCF9fa4f9C56B0F40a671Ad40E0805A091865");
const zeroAddress = "0x0000000000000000000000000000000000000000";
const Q192 = 2n ** 192n;

const parametersSchema = z
  .object({
    positionTokenId: z.string().regex(/^[1-9]\d*$/u),
    rangeWidthBps: z.number().int().min(100).max(5_000),
    maxSlippageBps: z.number().int().min(1).max(500).default(50),
  })
  .strict();

type PartialRebalanceProgress = {
  oldPositionTokenId: string;
  walletAddress: Address;
  pool: Address;
  withdrawalTransactionHash: Hex;
  swapTransactionHash: Hex | null;
};

/** A V3 rebalance spans more than one authorized transaction. */
export class PartialLpRebalanceError extends Error {
  public constructor(message: string, public readonly progress: PartialRebalanceProgress) {
    super(message);
    this.name = "PartialLpRebalanceError";
  }

  public receipt(observedAt: string): ExecutionReceipt {
    return {
      source: "onchain_verified",
      outcome: {
        success: false,
        recoveryRequired: true,
        message: this.message,
        oldPositionTokenId: this.progress.oldPositionTokenId,
        withdrawalTransactionHash: this.progress.withdrawalTransactionHash,
        swapTransactionHash: this.progress.swapTransactionHash,
      },
      evidence: {
        blockchainWrite: true,
        walletAuthorization: true,
        recoveryRequired: true,
        chainId,
        positionManager,
        pool: this.progress.pool,
        walletAddress: this.progress.walletAddress,
        oldPositionTokenId: this.progress.oldPositionTokenId,
        withdrawalTransactionHash: this.progress.withdrawalTransactionHash,
        swapTransactionHash: this.progress.swapTransactionHash,
      },
      cost: null,
      transactionHash: this.progress.swapTransactionHash ?? this.progress.withdrawalTransactionHash,
      jobId: null,
      observedAt,
    };
  }
}

export class PancakeLpRebalanceExecutor {
  public constructor(
    private readonly sessions: DrizzleAltanaSessionAuthorizationStore,
    private readonly encryption: AltanaSessionEncryption,
    private readonly rpcUrl: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public supports(record: ExecutionRecord) {
    return (
      record.chainId === chainId &&
      record.action.actionType === "rebalance_liquidity" &&
      record.action.capability === "submit_transactions" &&
      record.action.protocol?.toLowerCase() === "pancakeswap" &&
      record.action.target !== null &&
      getAddress(record.action.target) === positionManager
    );
  }

  public async execute(record: ExecutionRecord): Promise<ExecutionReceipt> {
    if (!this.supports(record)) throw new Error("Unsupported transactional execution request");
    let progress: PartialRebalanceProgress | null = null;
    try {
    const parameters = parametersSchema.parse(record.action.parameters);
    const authorization = await this.sessions.find(record.mandateId, record.principalId);
    if (authorization === null || authorization.status !== "GRANTED" || authorization.walletAddress === null)
      throw new Error("The buyer's trading session is not active for this mandate");
    if (authorization.expiresAt <= this.now()) throw new Error("The buyer's trading session has expired");

    const client = createPublicClient({ transport: http(this.rpcUrl) });
    const wallet = getAddress(authorization.walletAddress);
    const tokenId = BigInt(parameters.positionTokenId);
    const [owner, position] = await Promise.all([
      client.readContract({ address: positionManager, abi: positionManagerAbi, functionName: "ownerOf", args: [tokenId] }),
      client.readContract({ address: positionManager, abi: positionManagerAbi, functionName: "positions", args: [tokenId] }),
    ]);
    if (getAddress(owner) !== wallet) throw new Error("The authorized wallet does not own the selected LP position");

    const [
      ,
      ,
      token0Value,
      token1Value,
      fee,
      tickLower,
      tickUpper,
      liquidity,
      ,
      ,
      tokensOwed0,
      tokensOwed1,
    ] = position;
    const token0 = getAddress(token0Value);
    const token1 = getAddress(token1Value);
    if (!isBnbUsdtPair(token0, token1)) throw new Error("Only the BSC Testnet WBNB/TEST_USDT pool is supported");
    if (liquidity === 0n) throw new Error("The selected LP position has no active liquidity to rebalance");

    const pool = await client.readContract({
      address: pancakeV3Factory,
      abi: factoryAbi,
      functionName: "getPool",
      args: [token0, token1, fee],
    });
    if (pool === zeroAddress) throw new Error("No PancakeSwap V3 pool exists for this LP position");
    const poolAddress = getAddress(pool);
    const [slot0, tickSpacing] = await Promise.all([
      client.readContract({ address: poolAddress, abi: poolAbi, functionName: "slot0" }),
      client.readContract({ address: poolAddress, abi: poolAbi, functionName: "tickSpacing" }),
    ]);
    if (slot0[1] >= tickLower && slot0[1] <= tickUpper)
      throw new Error("The selected LP position is still in range; no rebalance is required");

    const deadline = BigInt(Math.floor(this.now().getTime() / 1_000) + 600);
    const simulatedWithdrawal = await client.simulateContract({
      address: positionManager,
      abi: positionManagerAbi,
      functionName: "decreaseLiquidity",
      args: [{ tokenId, liquidity, amount0Min: 0n, amount1Min: 0n, deadline }],
      account: wallet,
    });
    const [expected0, expected1] = simulatedWithdrawal.result;
    const [balance0Before, balance1Before, allowance0, allowance1] = await Promise.all([
      client.readContract({ address: token0, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
      client.readContract({ address: token1, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
      client.readContract({ address: token0, abi: erc20Abi, functionName: "allowance", args: [wallet, positionManager] }),
      client.readContract({ address: token1, abi: erc20Abi, functionName: "allowance", args: [wallet, positionManager] }),
    ]);
    const cap = parseCap(record.action.amount);
    const projectedBalances = {
      token0,
      token1,
      balance0: balance0Before + expected0 + tokensOwed0,
      balance1: balance1Before + expected1 + tokensOwed1,
      cap,
      sqrtPriceX96: slot0[0],
    };
    const projectedSwap = rebalanceSwap(projectedBalances);
    const projected = projectedSwap === null
      ? capDesiredAmounts(projectedBalances)
      : desiredAmountsForCap(projectedBalances);
    if (projected.amount0 === 0n || projected.amount1 === 0n)
      throw new Error("Rebalance cannot complete safely with the available WBNB/TEST_USDT balances. No liquidity was withdrawn.");
    if (allowance0 < projected.amount0 || allowance1 < projected.amount1)
      throw new Error("Approve PancakeSwap V3 Position Manager for both WBNB and TEST_USDT before this mandate can rebalance. No liquidity was withdrawn.");
    if (projectedSwap !== null) {
      const routerAllowance = await client.readContract({
        address: projectedSwap.tokenIn,
        abi: erc20Abi,
        functionName: "allowance",
        args: [wallet, swapRouter],
      });
      if (routerAllowance < projectedSwap.amountIn)
        throw new Error("Approve PancakeSwap V3 SwapRouter for the required balancing swap. No liquidity was withdrawn.");
    }
    const withdrawalData = encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "multicall",
      args: [
        [
          encodeFunctionData({
            abi: positionManagerAbi,
            functionName: "decreaseLiquidity",
            args: [{
              tokenId,
              liquidity,
              amount0Min: minimum(expected0, parameters.maxSlippageBps),
              amount1Min: minimum(expected1, parameters.maxSlippageBps),
              deadline,
            }],
          }),
          encodeFunctionData({
            abi: positionManagerAbi,
            functionName: "collect",
            args: [{ tokenId, recipient: wallet, amount0Max: maxUint128, amount1Max: maxUint128 }],
          }),
        ],
      ],
    });
    const session = this.#session(authorization);
    const altana = createClient({ chains: [BNB_TESTNET] });
    const withdrawal = await altana.execute({
      session,
      chainId,
      calls: { to: positionManager, data: withdrawalData },
    });
    if (withdrawal.status !== "CONFIRMED" || withdrawal.transactionHash === undefined)
      throw new Error("The liquidity withdrawal did not receive a confirmed transaction receipt");
    progress = {
      oldPositionTokenId: tokenId.toString(),
      walletAddress: wallet,
      pool: poolAddress,
      withdrawalTransactionHash: withdrawal.transactionHash,
      swapTransactionHash: null,
    };

    let [balance0, balance1, freshSlot0] = await Promise.all([
      client.readContract({ address: token0, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
      client.readContract({ address: token1, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
      client.readContract({ address: poolAddress, abi: poolAbi, functionName: "slot0" }),
    ]);
    const swap = rebalanceSwap({ token0, token1, balance0, balance1, cap, sqrtPriceX96: freshSlot0[0] });
    let swapTransactionHash: Hex | null = null;
    if (swap !== null) {
      const simulation = await client.simulateContract({
        address: swapRouter,
        abi: swapRouterAbi,
        functionName: "exactInputSingle",
        args: [{
          tokenIn: swap.tokenIn,
          tokenOut: swap.tokenOut,
          fee,
          recipient: wallet,
          amountIn: swap.amountIn,
          amountOutMinimum: 0n,
          sqrtPriceLimitX96: 0n,
        }],
        account: wallet,
      });
      if (simulation.result === 0n) throw new Error("PancakeSwap returned a zero-output rebalance quote after withdrawal");
      const swapData = encodeFunctionData({
        abi: swapRouterAbi,
        functionName: "exactInputSingle",
        args: [{
          tokenIn: swap.tokenIn,
          tokenOut: swap.tokenOut,
          fee,
          recipient: wallet,
          amountIn: swap.amountIn,
          amountOutMinimum: minimum(simulation.result, parameters.maxSlippageBps),
          sqrtPriceLimitX96: 0n,
        }],
      });
      const swapped = await altana.execute({ session, chainId, calls: { to: swapRouter, data: swapData } });
      if (swapped.status !== "CONFIRMED" || swapped.transactionHash === undefined)
        throw new Error("The PancakeSwap balancing swap did not receive a confirmed transaction receipt");
      swapTransactionHash = swapped.transactionHash;
      progress.swapTransactionHash = swapped.transactionHash;
      [balance0, balance1] = await Promise.all([
        client.readContract({ address: token0, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
        client.readContract({ address: token1, abi: erc20Abi, functionName: "balanceOf", args: [wallet] }),
      ]);
      freshSlot0 = await client.readContract({ address: poolAddress, abi: poolAbi, functionName: "slot0" });
    }
    const desired = capDesiredAmounts({ token0, token1, balance0, balance1, cap, sqrtPriceX96: freshSlot0[0] });
    if (desired.amount0 === 0n || desired.amount1 === 0n)
      throw new Error("Rebalancing requires both WBNB and TEST_USDT after withdrawal; fund or swap the missing asset before retrying");

    const nextRange = proposedRange(freshSlot0[1], Number(tickSpacing), parameters.rangeWidthBps);
    const simulatedMint = await client.simulateContract({
      address: positionManager,
      abi: positionManagerAbi,
      functionName: "mint",
      args: [{
        token0,
        token1,
        fee,
        tickLower: nextRange.lower,
        tickUpper: nextRange.upper,
        amount0Desired: desired.amount0,
        amount1Desired: desired.amount1,
        amount0Min: 0n,
        amount1Min: 0n,
        recipient: wallet,
        deadline,
      }],
      account: wallet,
    });
    const [, , used0, used1] = simulatedMint.result;
    const mintData = encodeFunctionData({
      abi: positionManagerAbi,
      functionName: "multicall",
      args: [[
        encodeFunctionData({
          abi: positionManagerAbi,
          functionName: "mint",
          args: [{
            token0,
            token1,
            fee,
            tickLower: nextRange.lower,
            tickUpper: nextRange.upper,
            amount0Desired: desired.amount0,
            amount1Desired: desired.amount1,
            amount0Min: minimum(used0, parameters.maxSlippageBps),
            amount1Min: minimum(used1, parameters.maxSlippageBps),
            recipient: wallet,
            deadline,
          }],
        }),
        encodeFunctionData({ abi: positionManagerAbi, functionName: "burn", args: [tokenId] }),
      ]],
    });
    const minted = await altana.execute({
      session,
      chainId,
      calls: { to: positionManager, data: mintData },
    });
    if (minted.status !== "CONFIRMED" || minted.transactionHash === undefined)
      throw new Error("The replacement position did not receive a confirmed transaction receipt");

    return {
      source: "onchain_verified",
      outcome: {
        success: true,
        oldPositionTokenId: tokenId.toString(),
        newRange: nextRange,
        withdrawalTransactionHash: withdrawal.transactionHash,
        swapTransactionHash,
        mintTransactionHash: minted.transactionHash,
      },
      evidence: {
        blockchainWrite: true,
        walletAuthorization: true,
        chainId,
        positionManager,
        pool: poolAddress,
        walletAddress: wallet,
        token0,
        token1,
        oldPositionTokenId: tokenId.toString(),
        withdrawalTransactionHash: withdrawal.transactionHash,
        swapTransactionHash,
        mintTransactionHash: minted.transactionHash,
      },
      cost: null,
      transactionHash: minted.transactionHash,
      jobId: null,
      observedAt: this.now().toISOString(),
    };
    } catch (error) {
      if (error instanceof PartialLpRebalanceError || progress === null) throw error;
      throw new PartialLpRebalanceError(
        error instanceof Error ? error.message : "LP rebalance requires recovery after a confirmed transaction",
        progress,
      );
    }
  }

  #session(record: AltanaSessionAuthorizationRecord): Session {
    if (record.walletAddress === null) throw new Error("The buyer session does not have a wallet address");
    const permissions = record.permissions as {
      calls?: Array<{ to: string }>;
      spend?: Array<{ token?: string; limit: string; period: "day" }>;
    };
    return {
      walletAddress: getAddress(record.walletAddress),
      signer: signerFromPrivateKey(this.encryption.decrypt(record.encryptedSessionPrivateKey) as Hex),
      publicKey: record.sessionPublicKey as Hex,
      permissions: {
        ...(permissions.calls === undefined
          ? {}
          : { calls: permissions.calls.map(({ to }) => ({ to: getAddress(to) })) }),
        ...(permissions.spend === undefined
          ? {}
          : {
              spend: permissions.spend.map(({ token, limit, period }) => ({
                ...(token === undefined ? {} : { token: getAddress(token) }),
                limit: BigInt(limit),
                period,
              })),
            }),
      },
      expiry: Math.floor(record.expiresAt.getTime() / 1_000),
    };
  }
}

function isBnbUsdtPair(token0: Address, token1: Address) {
  return (token0 === wbnb && token1 === testUsdt) || (token0 === testUsdt && token1 === wbnb);
}

function parseCap(amount: string | null) {
  if (amount === null || !/^\d+(?:\.\d+)?$/u.test(amount)) throw new Error("A TEST_USDT capital cap is required for a rebalance");
  const [whole, fraction = ""] = amount.split(".");
  return BigInt(`${whole}${fraction.padEnd(18, "0").slice(0, 18)}`);
}

function minimum(amount: bigint, maxSlippageBps: number) {
  return (amount * BigInt(10_000 - maxSlippageBps)) / 10_000n;
}

function capDesiredAmounts(input: {
  token0: Address;
  token1: Address;
  balance0: bigint;
  balance1: bigint;
  cap: bigint;
  sqrtPriceX96: bigint;
}) {
  const square = input.sqrtPriceX96 * input.sqrtPriceX96;
  const stableIsToken0 = input.token0 === testUsdt;
  const stableBalance = stableIsToken0 ? input.balance0 : input.balance1;
  const wbnbBalance = stableIsToken0 ? input.balance1 : input.balance0;
  const stableTarget = stableBalance < input.cap / 2n ? stableBalance : input.cap / 2n;
  const remainingStableValue = input.cap - stableTarget;
  const wbnbTarget = stableIsToken0
    ? (remainingStableValue * square) / Q192
    : (remainingStableValue * Q192) / square;
  const boundedWbnb = wbnbBalance < wbnbTarget ? wbnbBalance : wbnbTarget;
  return stableIsToken0
    ? { amount0: stableTarget, amount1: boundedWbnb }
    : { amount0: boundedWbnb, amount1: stableTarget };
}

function desiredAmountsForCap(input: {
  token0: Address;
  token1: Address;
  cap: bigint;
  sqrtPriceX96: bigint;
}) {
  const square = input.sqrtPriceX96 * input.sqrtPriceX96;
  const stableIsToken0 = input.token0 === testUsdt;
  const stableTarget = input.cap / 2n;
  const wbnbTarget = stableIsToken0
    ? (stableTarget * square) / Q192
    : (stableTarget * Q192) / square;
  return stableIsToken0
    ? { amount0: stableTarget, amount1: wbnbTarget }
    : { amount0: wbnbTarget, amount1: stableTarget };
}

/** Select a single-pool exact-input swap that moves the withdrawn assets
 * toward a 50/50 value split before minting the replacement position. */
function rebalanceSwap(input: {
  token0: Address;
  token1: Address;
  balance0: bigint;
  balance1: bigint;
  cap: bigint;
  sqrtPriceX96: bigint;
}) {
  const square = input.sqrtPriceX96 * input.sqrtPriceX96;
  const stableIsToken0 = input.token0 === testUsdt;
  const stableBalance = stableIsToken0 ? input.balance0 : input.balance1;
  const wbnbBalance = stableIsToken0 ? input.balance1 : input.balance0;
  const wbnbValueInStable = stableIsToken0
    ? (wbnbBalance * Q192) / square
    : (wbnbBalance * square) / Q192;
  const capital = input.cap < stableBalance + wbnbValueInStable
    ? input.cap
    : stableBalance + wbnbValueInStable;
  if (capital < 2n) return null;
  const targetStable = capital / 2n;
  const targetWbnb = stableIsToken0
    ? (targetStable * square) / Q192
    : (targetStable * Q192) / square;
  if (stableBalance > targetStable) {
    return {
      tokenIn: stableIsToken0 ? input.token0 : input.token1,
      tokenOut: stableIsToken0 ? input.token1 : input.token0,
      amountIn: stableBalance - targetStable,
    };
  }
  if (wbnbBalance > targetWbnb) {
    return {
      tokenIn: stableIsToken0 ? input.token1 : input.token0,
      tokenOut: stableIsToken0 ? input.token0 : input.token1,
      amountIn: wbnbBalance - targetWbnb,
    };
  }
  return null;
}

function proposedRange(currentTick: number, spacing: number, rangeWidthBps: number) {
  if (!Number.isInteger(spacing) || spacing <= 0) throw new Error("Invalid PancakeSwap V3 tick spacing");
  const halfWidthTicks = Math.ceil(Math.log1p(rangeWidthBps / 10_000) / Math.log(1.0001));
  const lower = Math.floor((currentTick - halfWidthTicks) / spacing) * spacing;
  const upper = Math.ceil((currentTick + halfWidthTicks) / spacing) * spacing;
  if (lower < -887_272 || upper > 887_272 || lower >= upper) throw new Error("Requested LP range is outside PancakeSwap V3 tick bounds");
  return { lower, upper };
}
