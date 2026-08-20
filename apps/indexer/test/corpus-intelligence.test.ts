import { describe, expect, it } from "vitest";

import {
  classifyAgent,
  duplicateFingerprint,
  extractServiceDeclarations,
  normalizeCapabilities,
  normalizeServiceType,
  profileQuality,
} from "../src/corpus-intelligence.js";

const baseAgent = {
  id: "scan-7",
  token_id: "7",
  chain_id: 56,
  contract_address: `0x${"8".repeat(40)}`,
  owner_address: `0x${"1".repeat(40)}`,
  supported_protocols: [] as string[],
};

describe("deterministic corpus intelligence", () => {
  it("normalizes capability aliases and service types while preserving raw names", () => {
    expect(
      normalizeCapabilities([
        "yield-farming",
        "yield_optimization",
        "Yield Optimizer",
        "defi-yield",
      ]),
    ).toEqual(["yield-optimisation"]);
    expect(normalizeServiceType("Model Context Protocol")).toBe("mcp");
    expect(normalizeServiceType("ERC-8183")).toBe("erc8183");
    const declarations = extractServiceDeclarations({
      ...baseAgent,
      supported_protocols: ["MCP", "Something New"],
    });
    expect(declarations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          rawName: "Something New",
          normalizedType: "other:something-new",
        }),
      ]),
    );
  });

  it("supports current services and legacy endpoints metadata deterministically", () => {
    const current = extractServiceDeclarations({
      ...baseAgent,
      raw_metadata: {
        services: [
          { name: "ERC8183", endpoint: "https://seller.example/erc8183" },
        ],
        endpoints: [{ name: "MCP", endpoint: "https://legacy.example" }],
      },
    });
    expect(current).toEqual([
      expect.objectContaining({
        normalizedType: "erc8183",
        endpoint: "https://seller.example/erc8183",
      }),
    ]);
    expect(
      extractServiceDeclarations({
        ...baseAgent,
        raw_metadata: {
          endpoints: [{ name: "MCP", endpoint: "https://legacy.example" }],
        },
      }),
    ).toEqual([
      expect.objectContaining({
        normalizedType: "mcp",
        endpoint: "https://legacy.example",
      }),
    ]);
  });

  it("classifies only explicit evidence and otherwise leaves agents uncategorized", () => {
    expect(
      classifyAgent({
        ...baseAgent,
        name: "Vault Health Factor Monitor",
        description: null,
      }),
    ).toEqual([
      expect.objectContaining({
        categorySlug: "health-factor-monitoring",
        confidence: "medium",
        matchedSource: "name",
      }),
    ]);
    expect(
      classifyAgent({
        ...baseAgent,
        name: "General assistant",
        description: "Helpful",
      }),
    ).toEqual([]);
  });

  it("separates listing completeness from actionable readiness", () => {
    const discoverable = profileQuality({
      agent: {
        ...baseAgent,
        name: "Grid Trader",
        description:
          "A deterministic grid trading service with a documented operating profile.",
        supported_protocols: ["A2A"],
      },
      categoryCount: 1,
    });
    expect(discoverable.readiness).toBe("DISCOVERABLE");
    expect(discoverable.facts.hasImage).toBe(false);
    expect(duplicateFingerprint(" Same  text ")).toBe(
      duplicateFingerprint("same text"),
    );
  });
});
