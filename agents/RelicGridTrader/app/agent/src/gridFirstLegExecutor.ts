import { BNB_TESTNET, createClient, signerFromPrivateKey, type Session } from "@altananetwork/sdk";
import { createPublicClient, encodeFunctionData, getAddress, http, parseUnits, type Address } from "viem";
import { bscTestnet } from "viem/chains";
import type { GridExecutionRequest, GridFundedSession } from "./gridFundedSessionClient.js";
import type { GridRuntimeConfig } from "./gridRuntimeConfig.js";

const Q192 = 2n ** 192n;
const erc20Abi = [
  { type: "function", name: "allowance", stateMutability: "view", inputs: [{ name: "owner", type: "address" }, { name: "spender", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
  { type: "function", name: "approve", stateMutability: "nonpayable", inputs: [{ name: "spender", type: "address" }, { name: "amount", type: "uint256" }], outputs: [{ name: "", type: "bool" }] },
  { type: "function", name: "balanceOf", stateMutability: "view", inputs: [{ name: "owner", type: "address" }], outputs: [{ name: "", type: "uint256" }] },
] as const;
const poolAbi = [
  { type: "function", name: "token0", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "token1", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "address" }] },
  { type: "function", name: "fee", stateMutability: "view", inputs: [], outputs: [{ name: "", type: "uint24" }] },
  { type: "function", name: "slot0", stateMutability: "view", inputs: [], outputs: [{ name: "sqrtPriceX96", type: "uint160" }, { name: "tick", type: "int24" }, { name: "observationIndex", type: "uint16" }, { name: "observationCardinality", type: "uint16" }, { name: "observationCardinalityNext", type: "uint16" }, { name: "feeProtocol", type: "uint32" }, { name: "unlocked", type: "bool" }] },
] as const;
const routerAbi = [{ type: "function", name: "exactInputSingle", stateMutability: "payable", inputs: [{ name: "params", type: "tuple", components: [
  { name: "tokenIn", type: "address" }, { name: "tokenOut", type: "address" }, { name: "fee", type: "uint24" }, { name: "recipient", type: "address" }, { name: "amountIn", type: "uint256" }, { name: "amountOutMinimum", type: "uint256" }, { name: "sqrtPriceLimitX96", type: "uint160" },
] }], outputs: [{ name: "amountOut", type: "uint256" }] }] as const;

const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();
const permissions = (value: Record<string, unknown>, config: GridRuntimeConfig): Session["permissions"] => {
  const source = value as { calls?: Array<{ to?: unknown }>; spend?: Array<{ token?: unknown; limit?: unknown; period?: unknown }> };
  if (!Array.isArray(source.calls) || !Array.isArray(source.spend)) throw new Error("Grid signing denied: released session lacks bounded permissions");
  const allowedCalls = [config.usdt, config.wrappedBnb, config.router];
  const calls = source.calls.map(({ to }) => {
    if (typeof to !== "string" || !allowedCalls.some((allowed) => same(allowed, to))) throw new Error("Grid signing denied: unexpected call permission");
    return { to: getAddress(to) };
  });
  const spend = source.spend.map(({ token, limit, period }) => {
    if (typeof token !== "string" || ![config.usdt, config.wrappedBnb].some((allowed) => same(allowed, token)) || typeof limit !== "string" || !/^\d+$/u.test(limit) || BigInt(limit) <= 0n || period !== "day") throw new Error("Grid signing denied: unexpected spend permission");
    return { token: getAddress(token), limit: BigInt(limit), period: "day" as const };
  });
  return { calls, spend };
};

/** Executes exactly one first grid entry. It never accepts calldata, addresses,
 * price bounds, or amounts from A2A input: all values come from Relic's
 * canonical funded request and configured BSC Testnet contracts. */
export async function executeFirstGridLeg(input: { config: GridRuntimeConfig; request: GridExecutionRequest; session: GridFundedSession }) {
  const { config, request, session } = input;
  if (!same(request.mandate.account, session.walletAddress)) throw new Error("Grid signing denied: funded session owner does not match mandate");
  if (request.mandate.expiresAt > session.expiresAt || request.mandate.expiresAt <= new Date()) throw new Error("Grid signing denied: mandate is expired or exceeds its session");
  if (request.mandate.maximumCapitalBaseUnits > config.maximumJobAmountBaseUnits) throw new Error("Grid signing denied: mandate exceeds the deployment cap");
  const client = createPublicClient({ chain: bscTestnet, transport: http(config.rpcUrl) });
  if (await client.getChainId() !== config.chainId) throw new Error("Grid signing denied: RPC is not BSC Testnet");
  const [token0, token1, fee, slot0, nativeBalance, usdtBefore, wbnbBefore] = await Promise.all([
    client.readContract({ address: config.pool, abi: poolAbi, functionName: "token0" }),
    client.readContract({ address: config.pool, abi: poolAbi, functionName: "token1" }),
    client.readContract({ address: config.pool, abi: poolAbi, functionName: "fee" }),
    client.readContract({ address: config.pool, abi: poolAbi, functionName: "slot0" }),
    client.getBalance({ address: session.walletAddress }),
    client.readContract({ address: config.usdt, abi: erc20Abi, functionName: "balanceOf", args: [session.walletAddress] }),
    client.readContract({ address: config.wrappedBnb, abi: erc20Abi, functionName: "balanceOf", args: [session.walletAddress] }),
  ]);
  if (!((same(token0, config.usdt) && same(token1, config.wrappedBnb)) || (same(token0, config.wrappedBnb) && same(token1, config.usdt))) || fee !== config.fee || slot0[0] === 0n) throw new Error("Grid signing denied: configured pool does not match the approved pair and fee tier");
  if (nativeBalance < config.minimumBnbGasReserveWei) throw new Error("Grid signing denied: buyer wallet is below the required BNB gas reserve");
  const price = priceUsdtPerBnbScaled(slot0[0], same(token0, config.wrappedBnb), config.usdtDecimals);
  const lower = parseUnits(request.mandate.lowerPrice, 18);
  const upper = parseUnits(request.mandate.upperPrice, 18);
  if (price < lower || price > upper) return { status: "not_executed", reason: "live_price_outside_buyer_range", priceUsdtPerBnb: formatPrice(price) };
  const amountIn = request.mandate.maximumCapitalBaseUnits / BigInt(request.mandate.gridLevels);
  if (amountIn <= 0n || amountIn > usdtBefore) throw new Error("Grid signing denied: buyer wallet lacks the first bounded grid amount");
  const minimumOut = (amountIn * (10n ** BigInt(36 - config.usdtDecimals)) * 98n) / (price * 100n);
  if (minimumOut <= 0n) throw new Error("Grid signing denied: live price yields zero minimum output");
  const altana = createClient({ chains: [BNB_TESTNET] });
  const scoped: Session = { walletAddress: getAddress(session.walletAddress), signer: signerFromPrivateKey(session.sessionPrivateKey), publicKey: session.sessionPublicKey, permissions: permissions(session.permissions, config), expiry: Math.floor(session.expiresAt.getTime() / 1_000) };
  let reservedFeeWei = 0n;
  const send = async (to: Address, data: `0x${string}`) => {
    const gas = await client.estimateGas({ account: scoped.walletAddress, to, data });
    const estimatedFeeWei = gas * await client.getGasPrice();
    if (reservedFeeWei + estimatedFeeWei > request.maximumFeeWei) throw new Error("Grid signing denied: estimated transaction fees exceed the buyer cap");
    reservedFeeWei += estimatedFeeWei;
    const result = await altana.execute({ session: scoped, chainId: config.chainId, calls: { to, data } });
    if (result.status !== "CONFIRMED" || !result.transactionHash) throw new Error("Grid signing denied: Altana session execution did not confirm");
    const receipt = await client.waitForTransactionReceipt({ hash: result.transactionHash });
    if (receipt.status !== "success") throw new Error("Grid signing denied: transaction receipt reverted");
    return result.transactionHash;
  };
  let approvalTx: `0x${string}` | undefined;
  const allowance = await client.readContract({ address: config.usdt, abi: erc20Abi, functionName: "allowance", args: [session.walletAddress, config.router] });
  if (allowance < amountIn) approvalTx = await send(config.usdt, encodeFunctionData({ abi: erc20Abi, functionName: "approve", args: [config.router, amountIn] }));
  const deadline = BigInt(Math.floor(Math.min(request.mandate.expiresAt.getTime(), Date.now() + 10 * 60_000) / 1_000));
  const swapTx = await send(config.router, encodeFunctionData({ abi: routerAbi, functionName: "exactInputSingle", args: [{ tokenIn: config.usdt, tokenOut: config.wrappedBnb, fee: config.fee, recipient: session.walletAddress, amountIn, amountOutMinimum: minimumOut, sqrtPriceLimitX96: 0n }] }));
  const [usdtAfter, wbnbAfter] = await Promise.all([
    client.readContract({ address: config.usdt, abi: erc20Abi, functionName: "balanceOf", args: [session.walletAddress] }),
    client.readContract({ address: config.wrappedBnb, abi: erc20Abi, functionName: "balanceOf", args: [session.walletAddress] }),
  ]);
  if (usdtBefore - usdtAfter < amountIn || wbnbAfter - wbnbBefore < minimumOut) throw new Error("Grid signing denied: receipt reconciliation did not show the approved swap outcome");
  return { status: "executed", priceUsdtPerBnb: formatPrice(price), amountInBaseUnits: amountIn.toString(), minimumAmountOutBaseUnits: minimumOut.toString(), approvalTx, swapTx };
}

function priceUsdtPerBnbScaled(sqrtPriceX96: bigint, token0IsWbnb: boolean, usdtDecimals: number) {
  const square = sqrtPriceX96 * sqrtPriceX96;
  const scale = 10n ** BigInt(36 - usdtDecimals);
  return token0IsWbnb ? (square * scale) / Q192 : (Q192 * scale) / square;
}
function formatPrice(value: bigint) { const whole = value / 10n ** 18n; const fraction = (value % 10n ** 18n).toString().padStart(18, "0").slice(0, 6).replace(/0+$/u, ""); return fraction ? `${whole}.${fraction}` : whole.toString(); }
