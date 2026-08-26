import { describe, expect, it } from "vitest";

import {
  intentSearchParams,
  marketplaceOutcomeLabel,
  marketplacePriceLabel,
  productCapabilityLabel,
  provenanceLabel,
  readinessInventory,
  understandMarketplaceIntent,
} from "./marketplace";

describe("deterministic marketplace intent mapping", () => {
  it("maps liquidation protection to health-factor filters", () => {
    expect(
      understandMarketplaceIntent("Protect my Venus position from liquidation"),
    ).toEqual({
      category: "health-factor-monitoring",
      protocol: "Venus",
    });
  });

  it("extracts structured yield intent without inventing an agent", () => {
    expect(
      understandMarketplaceIntent(
        "I have USDT sitting idle and want conservative yield",
      ),
    ).toEqual({
      category: "yield-optimisation",
      asset: "USDT",
      risk: "conservative",
    });
    const params = intentSearchParams(
      "I have USDT sitting idle and want conservative yield",
    );
    expect(params.get("category")).toBe("yield-optimisation");
    expect(params.get("requirements")).toBe("USDT,conservative");
    expect(params.has("agent")).toBe(false);
  });

  it("uses ecosystem protocols as evidence requirements, not interface filters", () => {
    const params = intentSearchParams(
      "Protect my Venus position from liquidation",
    );
    expect(params.get("requirements")).toBe("Venus");
    expect(params.has("protocol")).toBe(false);
  });

  it("presents provenance in human language", () => {
    expect(provenanceLabel("onchain_verified")).toBe("Onchain verified");
    expect(provenanceLabel("secondary_unverified")).toBe(
      "Secondary / unverified",
    );
  });

  it("uses the active offer as the shared marketplace price", () => {
    expect(
      marketplacePriceLabel({
        amountBaseUnits: "0",
        decimals: 18,
        symbol: "tBNB",
        tokenAddress: "0x0000000000000000000000000000000000000000",
      }),
    ).toBe("Free");
    expect(
      marketplacePriceLabel({
        amountBaseUnits: "1250000",
        decimals: 6,
        symbol: "USDC",
        tokenAddress: "0x0000000000000000000000000000000000000001",
      }),
    ).toBe("1.25 USDC");
    expect(marketplacePriceLabel(null)).toBe("No active offer");
  });

  it("keeps invocation evidence distinct from completed commerce", () => {
    expect(
      marketplaceOutcomeLabel({
        invocationSuccessful: true,
        commerceSuccessful: false,
        executionDurationMs: 24,
        responseStatus: "200",
        deliveredAt: null,
        settlementState: "NOT_STARTED",
        observedCost: "0",
        observedAt: "2026-08-20T12:00:00.000Z",
      }),
    ).toBe("Verified service check");
  });

  it("does not convert a readiness API failure into zero inventory", () => {
    expect(
      readinessInventory([
        { data: null, error: "Marketplace API returned 422" },
      ]),
    ).toEqual({ ok: false, error: "Marketplace API returned 422" });
  });

  it("keeps protocol interface names out of primary capability copy", () => {
    expect(productCapabilityLabel("erc8183")).toBe("Managed service lifecycle");
    expect(productCapabilityLabel("monitor_positions")).toBe(
      "Monitor Positions",
    );
  });
});
