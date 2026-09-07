import test from "node:test";
import assert from "node:assert/strict";
import { VenusJsonRpcClient } from "./venusRpcClient.js";

const word = (value: bigint) => value.toString(16).padStart(64, "0");
const addressWord = (address: string) => `0x${address.slice(2).padStart(64, "0")}`;
const usdt = "0x1111111111111111111111111111111111111111";
const comptroller = "0x2222222222222222222222222222222222222222";

function rpc(resultFor: (method: string, data?: string) => string): typeof fetch {
  return (async (_url, init) => {
    const request = JSON.parse(String(init?.body)) as { method: string; params: Array<{ data?: string }> };
    return new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result: resultFor(request.method, request.params[0]?.data) }), { status: 200 });
  }) as typeof fetch;
}

test("reads chain, token metadata, and Venus market relations", async () => {
  const client = new VenusJsonRpcClient("https://rpc.example", rpc((method, data) => {
    if (method === "eth_chainId") return "0x61";
    if (method === "eth_getCode") return "0x6000";
    if (data === "0x95d89b41") return `0x${Buffer.from("USDT", "utf8").toString("hex").padEnd(64, "0")}`;
    if (data === "0x313ce567") return `0x${word(18n)}`;
    if (data === "0x6f307dc3") return addressWord(usdt);
    if (data === "0x5fe3b567") return addressWord(comptroller);
    if (data === `0x70a08231${comptroller.slice(2).padStart(64, "0")}`) return `0x${word(123n)}`;
    throw new Error(`Unexpected request ${method} ${String(data)}`);
  }));
  assert.equal(await client.getChainId(), 97);
  assert.deepEqual(await client.getTokenMetadata(usdt as `0x${string}`), { symbol: "USDT", decimals: 18 });
  assert.equal(await client.getVTokenUnderlying(comptroller as `0x${string}`), usdt);
  assert.equal(await client.getVTokenComptroller(usdt as `0x${string}`), comptroller);
  assert.equal(await client.getTokenBalance(usdt as `0x${string}`, comptroller as `0x${string}`), 123n);
});

test("rejects malformed RPC values", async () => {
  const client = new VenusJsonRpcClient("https://rpc.example", rpc(() => "not-hex"));
  await assert.rejects(client.getChainId(), /invalid chain ID/);
});
