import { describe, expect, it } from "vitest";

import {
  intentSearchParams,
  provenanceLabel,
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
});
