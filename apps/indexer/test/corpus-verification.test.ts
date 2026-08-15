import type { RegistryAgentRecord } from "@relic/domain";
import { describe, expect, it } from "vitest";

import { verificationComparison } from "../src/corpus-verification.js";

const direct: RegistryAgentRecord = {
  source: "erc-8004:eip155:56:registry",
  chainId: 56,
  registryAddress: `0x${"8".repeat(40)}`,
  agentId: "9",
  ownerAddress: `0x${"2".repeat(40)}`,
  metadataUri: "https://example.com/agent.json",
  metadata: {},
  registrationTransaction: null,
  registrationBlock: null,
  registeredAt: null,
  fetchedAt: "2026-08-14T00:00:00.000Z",
  raw: {},
};

describe("direct and secondary convergence", () => {
  it("marks conflicting secondary owner data partial and retains authoritative facts", () => {
    const result = verificationComparison(
      {
        agentId: "01945b1e-7e80-7000-8000-000000000001",
        externalAgentId: "9",
        registryAddress: direct.registryAddress,
        secondaryOwner: `0x${"3".repeat(40)}`,
      },
      direct,
    );
    expect(result.status).toBe("partial");
    expect(result.mismatches).toHaveProperty("ownerAddress");
    expect(result.facts).toMatchObject({
      ownerAddress: direct.ownerAddress,
      metadataUri: direct.metadataUri,
    });
  });

  it("records a secondary metadata-pointer conflict without replacing the direct pointer", () => {
    const result = verificationComparison(
      {
        agentId: "01945b1e-7e80-7000-8000-000000000001",
        externalAgentId: "9",
        registryAddress: direct.registryAddress,
        secondaryOwner: direct.ownerAddress,
        secondaryMetadataUri: "https://secondary.example/agent.json",
      },
      direct,
    );
    expect(result.status).toBe("partial");
    expect(result.mismatches).toEqual({
      metadataUri: {
        secondary: "https://secondary.example/agent.json",
        onchain: direct.metadataUri,
      },
    });
    expect(result.facts.metadataUri).toBe(direct.metadataUri);
  });
});
