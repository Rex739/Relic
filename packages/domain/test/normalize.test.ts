import { describe, expect, it } from "vitest";

import {
  canonicalAgentSchema,
  normalizeRegistryAgent,
  primaryMarketplaceCategory,
} from "../src/index.js";
import { registryAgentFixture } from "./fixtures.js";

describe("canonical agent normalization", () => {
  it("validates a normalized ERC-8004 agent and preserves fact-level provenance", () => {
    const agent = normalizeRegistryAgent(registryAgentFixture, {
      id: "01945b1e-7e80-7000-8000-000000000001",
      now: "2026-01-02T00:00:00.000Z",
    });

    expect(canonicalAgentSchema.safeParse(agent).success).toBe(true);
    expect(agent.identity.fieldEvidence.ownerAddress?.[0]?.provenance).toBe(
      "onchain_verified",
    );
    expect(agent.profile.name?.evidence[0]?.provenance).toBe(
      "developer_declared",
    );
    expect(agent.services[0]?.evidence[0]?.sourceUri).toBe(
      registryAgentFixture.metadataUri,
    );
  });

  it("keeps an onchain identity indexable when metadata is malformed", () => {
    const agent = normalizeRegistryAgent({
      ...registryAgentFixture,
      metadata: { services: [] },
    });
    expect(agent.profile.name).toBeNull();
    expect(agent.services).toEqual([]);
  });

  it("preserves declared fields when first-registration metadata has a null agentId", () => {
    const agent = normalizeRegistryAgent({
      ...registryAgentFixture,
      metadata: {
        name: "First registration",
        image: null,
        services: [],
        registrations: [
          {
            agentId: null,
            agentRegistry:
              "eip155:56:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
          },
        ],
      },
    });
    expect(agent.profile.name?.value).toBe("First registration");
  });

  it("derives a seller onboarding category only from one verified category match", () => {
    const classified = normalizeRegistryAgent({
      ...registryAgentFixture,
      metadata: {
        type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
        description: "A read-only Venus yield opportunity monitor.",
        services: [
          {
            name: "Yield analysis",
            endpoint: "https://fixture.invalid/yield",
          },
        ],
      },
    });
    expect(primaryMarketplaceCategory(classified)).toBe("yield-optimisation");

    const ambiguous = normalizeRegistryAgent({
      ...registryAgentFixture,
      metadata: {
        type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
        services: [
          {
            name: "Mixed service",
            endpoint: "https://fixture.invalid/mixed",
            skills: ["yield-optimisation", "grid-trading"],
          },
        ],
      },
    });
    expect(primaryMarketplaceCategory(ambiguous)).toBeNull();
  });

  it("preserves a separately hosted public verification URL for each service", () => {
    const agent = normalizeRegistryAgent({
      ...registryAgentFixture,
      metadata: {
        services: [
          {
            name: "Yield analysis",
            endpoint: "https://private-runtime.example/invoke",
            relicVerificationUrl:
              "https://publisher.example/.well-known/relic-ready.json",
          },
        ],
      },
    });

    expect(agent.services[0]?.verificationUrl).toBe(
      "https://publisher.example/.well-known/relic-ready.json",
    );
  });

  it("uses a registry-level verification URL only for a single-service profile", () => {
    const verificationUrl =
      "https://publisher.example/.well-known/relic-ready.json";
    const singleService = normalizeRegistryAgent({
      ...registryAgentFixture,
      metadata: {
        relicVerificationUrl: verificationUrl,
        services: [{ name: "Yield analysis" }],
      },
    });
    const multiService = normalizeRegistryAgent({
      ...registryAgentFixture,
      metadata: {
        relicVerificationUrl: verificationUrl,
        services: [{ name: "Yield analysis" }, { name: "Alerts" }],
      },
    });

    expect(singleService.services[0]?.verificationUrl).toBe(verificationUrl);
    expect(multiService.services.every((service) => service.verificationUrl === null)).toBe(true);
  });

  it("rejects unsupported provenance labels", () => {
    const agent = normalizeRegistryAgent(registryAgentFixture);
    const invalid = structuredClone(agent);
    invalid.profile.name!.evidence[0]!.provenance =
      "trusted" as "onchain_verified";
    expect(canonicalAgentSchema.safeParse(invalid).success).toBe(false);
  });
});
