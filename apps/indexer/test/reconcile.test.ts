import type { AgentDetail } from "@relic/domain";
import { describe, expect, it } from "vitest";

import { reconcileAgent } from "../src/reconcile.js";

const direct = {
  id: "01945b1e-7e80-7000-8000-000000000001",
  name: "Agent",
  description: null,
  imageUrl: null,
  websiteUrl: null,
  metadataUri: "data:application/json,{}",
  chainId: 56,
  registryAddress: `0x${"1".repeat(40)}`,
  externalAgentId: "7",
  ownerAddress: `0x${"2".repeat(40)}`,
  registrationStatus: "registered",
  registrationTransaction: null,
  registrationBlock: "100",
  registeredAt: null,
  categories: [],
  capabilities: [],
  interfaces: [],
  readiness: null,
  verificationStatus: null,
  completenessPercent: null,
  taxonomy: [],
  services: [],
  provenance: [],
  updatedAt: "2026-08-13T00:00:00.000Z",
} satisfies AgentDetail;

describe("direct versus 8004scan reconciliation", () => {
  it("classifies objective matches and non-onchain missing values", () => {
    const facts = reconcileAgent(direct, {
      id: "scan-7",
      token_id: "7",
      chain_id: 56,
      contract_address: direct.registryAddress.toUpperCase(),
      owner_address: direct.ownerAddress.toUpperCase(),
      name: "Agent",
      description: "secondary only",
      supported_protocols: [],
    });
    expect(
      facts.find((fact) => fact.fieldPath === "identity.ownerAddress")?.status,
    ).toBe("match");
    expect(
      facts.find((fact) => fact.fieldPath === "profile.description")?.status,
    ).toBe("unverified_secondary");
  });

  it("classifies an onchain owner mismatch", () => {
    const facts = reconcileAgent(direct, {
      id: "scan-7",
      token_id: "7",
      chain_id: 56,
      contract_address: direct.registryAddress,
      owner_address: `0x${"9".repeat(40)}`,
      supported_protocols: [],
    });
    expect(
      facts.find((fact) => fact.fieldPath === "identity.ownerAddress")?.status,
    ).toBe("mismatch");
  });
});
