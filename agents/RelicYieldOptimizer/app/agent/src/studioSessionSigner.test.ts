import test from "node:test";
import assert from "node:assert/strict";
import { StudioSessionSigner } from "./studioSessionSigner.js";
import type { VenusTestnetConfig } from "./networkConfig.js";

const account = "0x1111111111111111111111111111111111111111" as const;
const market = "0x2222222222222222222222222222222222222222" as const;
const config: VenusTestnetConfig = {
  chainId: 97, rpcUrl: "https://rpc.example", usdt: account, venusComptroller: account,
  venusUsdtVToken: market, usdtDecimals: 6, maxJobAmountBaseUnits: 10n,
  minimumBnbGasReserveWei: 1n,
};
const vTokenAbi = [{
  type: "function",
  name: "mint",
  stateMutability: "nonpayable",
  inputs: [{ name: "mintAmount", type: "uint256" }],
  outputs: [{ name: "", type: "uint256" }],
}] as const;
const transaction = {
  to: market, data: `0xa0712d68${"1".padStart(64, "0")}` as const, value: 0n, maximumFeeWei: 10n,
  call: { address: market, abi: vTokenAbi, functionName: "mint", args: [1n] as const },
};

const setup = (overrides: { fee?: bigint; receipt?: "success" | "reverted" | null; status?: number } = {}) => {
  let intent: unknown;
  const client = {
    getChainId: async () => 97,
    getBalance: async () => 10n,
    call: async () => "0x" as const,
    estimateGas: async () => 2n,
    getGasPrice: async () => overrides.fee ?? 2n,
  };
  const wallet = {
    address: account,
    kind: "altana",
    supports: (capability: string) => capability === "broadcast.self",
    makeExecutor: () => ({ execute: async (value: unknown) => {
      intent = value;
      return {
        transactionHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" as const,
        status: overrides.status ?? 1,
        receipt: overrides.receipt === null ? null : { status: overrides.receipt ?? "success" },
      };
    } }),
  };
  return { signer: new StudioSessionSigner(config, wallet, client as never), getIntent: () => intent };
};

test("only executes a structured bounded call with the RPC-estimated gas limit", async () => {
  const { signer, getIntent } = setup();
  const hash = await signer.send(transaction);
  assert.equal(hash, "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
  assert.deepEqual(getIntent(), { call: transaction.call, value: 0n, gas: 2n, description: "Relic Yield Optimizer bounded Venus operation" });
});

test("rejects an over-cap fee or an unsuccessful Studio execution", async () => {
  await assert.rejects(setup({ fee: 6n }).signer.send(transaction), /fee exceeds/);
  await assert.rejects(setup({ receipt: "reverted" }).signer.send(transaction), /did not confirm/);
});

test("rejects a structured call whose target or calldata does not match the prepared transaction", async () => {
  const { signer } = setup();
  await assert.rejects(
    signer.send({ ...transaction, call: { ...transaction.call, address: account } }),
    /target differs/,
  );
  await assert.rejects(
    signer.send({ ...transaction, data: "0x" as const }),
    /differs from prepared calldata/,
  );
});
