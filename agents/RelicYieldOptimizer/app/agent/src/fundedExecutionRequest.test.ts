import test from "node:test";
import assert from "node:assert/strict";
import { parseVerifiedFundedYieldRequest } from "./fundedExecutionRequest.js";

const valid = () => ({
  kind: "relic.funded_yield_job.v1",
  id: "cf4a4e95-01ec-4e2d-afcf-7e6e4f7d5a6f",
  commerceJobId: "8183",
  idempotencyKey: "yield:8183:1",
  mandate: {
    jobId: "8183", account: "0x1111111111111111111111111111111111111111",
    expiresAt: "2026-09-08T00:00:00.000Z", maximumAmountBaseUnits: "1000000",
    minimumSecondsBetweenExecutions: "3600",
  },
  amountBaseUnits: "500000",
  maximumFeeWei: "1000000000000000",
});
const now = new Date("2026-09-07T12:00:00.000Z");

test("accepts only a bounded canonical funded-job relay body", () => {
  const request = parseVerifiedFundedYieldRequest(valid(), now);
  assert.equal(request.mandate.account, "0x1111111111111111111111111111111111111111");
  assert.equal(request.amountBaseUnits, 500000n);
});

test("rejects a browser A2A request instead of treating it as funded", () => {
  assert.throws(() => parseVerifiedFundedYieldRequest({ jsonrpc: "2.0", method: "message/send" }, now), /unsupported request kind/);
});

test("rejects expired or over-mandate values", () => {
  const expired = valid();
  expired.mandate.expiresAt = "2026-09-06T00:00:00.000Z";
  assert.throws(() => parseVerifiedFundedYieldRequest(expired, now), /has expired/);
  const tooLarge = valid();
  tooLarge.amountBaseUnits = "1000001";
  assert.throws(() => parseVerifiedFundedYieldRequest(tooLarge, now), /exceeds mandate/);
});
