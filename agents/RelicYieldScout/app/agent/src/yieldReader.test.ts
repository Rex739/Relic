import assert from "node:assert/strict";
import test from "node:test";
import {
  buildMarketResult,
  renderYieldReport,
  supplyApyPercent,
  utilizationPercent,
  type YieldObservation,
} from "./yieldReader.js";

test("builds a market result without inventing prices", () => {
  const result = buildMarketResult({
    address: "0x1111111111111111111111111111111111111111",
    symbol: "vTEST",
    supplyRateRaw: 1_000_000_000n,
    cashRaw: 700n,
    borrowsRaw: 300n,
    reservesRaw: 0n,
    secondsPerBlock: 0.75,
  });
  assert.equal(result.utilizationPercent, "30.000000");
  assert.ok(Number(result.estimatedSupplyApyPercent) > 0);
  assert.doesNotMatch(JSON.stringify(result), /usd/i);
});

test("zero denominator has no utilization", () => {
  assert.equal(utilizationPercent(0n, 0n, 0n), null);
});

test("rejects an invalid block interval", () => {
  assert.throws(() => supplyApyPercent(1n, 0), /secondsPerBlock/);
});

test("report is canonical JSON", () => {
  const observation = { z: 1, a: { b: 2 } } as unknown as YieldObservation;
  assert.equal(renderYieldReport(observation), '{"a":{"b":2},"z":1}');
});
