import { createPublicClient, getAddress, http, type Address } from "viem";
import { bsc, bscTestnet } from "viem/chains";

import type {
  HealthFactorInput,
  PositionReader,
  PositionSnapshot,
} from "./analysis.js";

const comptrollerAbi = [
  {
    type: "function",
    name: "getAccountLiquidity",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [
      { name: "error", type: "uint256" },
      { name: "liquidity", type: "uint256" },
      { name: "shortfall", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getAssetsIn",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "markets", type: "address[]" }],
  },
] as const;

const vTokenAbi = [
  {
    type: "function",
    name: "getAccountSnapshot",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [
      { name: "error", type: "uint256" },
      { name: "vTokenBalance", type: "uint256" },
      { name: "borrowBalance", type: "uint256" },
      { name: "exchangeRate", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "symbol",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "symbol", type: "string" }],
  },
] as const;

export class VenusCoreReader implements PositionReader {
  async read(input: HealthFactorInput): Promise<PositionSnapshot> {
    const rpcUrl =
      input.chainId === 97
        ? process.env.BSC_TESTNET_RPC_URL
        : process.env.BSC_MAINNET_RPC_URL;
    const configuredComptroller =
      input.chainId === 97
        ? process.env.VENUS_BSC_TESTNET_COMPTROLLER
        : process.env.VENUS_BSC_MAINNET_COMPTROLLER;
    if (!rpcUrl || !configuredComptroller)
      throw new Error(
        `Real Venus reads require the RPC URL and comptroller address for chain ${input.chainId}`,
      );
    const chain = input.chainId === 97 ? bscTestnet : bsc;
    const client = createPublicClient({ chain, transport: http(rpcUrl) });
    const comptroller = getAddress(configuredComptroller);
    const account = getAddress(input.account);
    const blockNumber = await client.getBlockNumber();
    const [liquidityResult, markets] = await Promise.all([
      client.readContract({
        address: comptroller,
        abi: comptrollerAbi,
        functionName: "getAccountLiquidity",
        args: [account],
        blockNumber,
      }),
      client.readContract({
        address: comptroller,
        abi: comptrollerAbi,
        functionName: "getAssetsIn",
        args: [account],
        blockNumber,
      }),
    ]);
    const snapshots = await Promise.all(
      markets.map(async (market: Address) => {
        const [snapshot, symbol] = await Promise.all([
          client.readContract({
            address: market,
            abi: vTokenAbi,
            functionName: "getAccountSnapshot",
            args: [account],
            blockNumber,
          }),
          client.readContract({
            address: market,
            abi: vTokenAbi,
            functionName: "symbol",
            blockNumber,
          }),
        ]);
        const [error, vTokenBalance, borrowBalance, exchangeRate] = snapshot;
        if (error !== 0n)
          throw new Error(
            `Venus market ${market} snapshot returned error ${error}`,
          );
        return {
          market,
          symbol,
          vTokenBalanceRaw: vTokenBalance.toString(),
          borrowBalanceRaw: borrowBalance.toString(),
          exchangeRateRaw: exchangeRate.toString(),
        };
      }),
    );
    return {
      source: "onchain",
      chainId: input.chainId,
      protocol: "venus-core",
      blockNumber: blockNumber.toString(),
      comptroller,
      errorCode: liquidityResult[0].toString(),
      liquidityRaw: liquidityResult[1].toString(),
      shortfallRaw: liquidityResult[2].toString(),
      markets: snapshots,
    };
  }
}
