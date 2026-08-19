import { describe, expect, it } from "vitest";

import { verifyErc8183Quote } from "../src/external-erc8183-invocation.js";

const status = {
  provider: `0x${"1".repeat(40)}`,
  service_price: "1000000000000000000",
  token_symbol: "U",
  network: "bsc-mainnet",
  chain_id: 56,
};

describe("external ERC-8183 negotiation evidence", () => {
  it("requires the live quote to match the advertised provider and terms", () => {
    expect(
      verifyErc8183Quote(status, {
        provider: status.provider,
        price: status.service_price,
        currency: status.token_symbol,
        estimated_completion_seconds: 300,
        service: "risk-adjusted BSC yield analysis",
        quoted_at: "2026-08-18T13:22:48.632554+00:00",
      }).quote.price,
    ).toBe("1000000000000000000");
  });

  it("rejects a price that differs from the public status route", () => {
    expect(() =>
      verifyErc8183Quote(status, {
        provider: status.provider,
        price: "0",
        currency: "U",
        estimated_completion_seconds: 300,
        service: "risk-adjusted BSC yield analysis",
        quoted_at: "2026-08-18T13:22:48.632554+00:00",
      }),
    ).toThrow(/price/);
  });
});
