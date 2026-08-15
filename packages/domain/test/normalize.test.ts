import { describe, expect, it } from "vitest";

import { canonicalAgentSchema, normalizeRegistryAgent } from "../src/index.js";
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

  it("rejects unsupported provenance labels", () => {
    const agent = normalizeRegistryAgent(registryAgentFixture);
    const invalid = structuredClone(agent);
    invalid.profile.name!.evidence[0]!.provenance =
      "trusted" as "onchain_verified";
    expect(canonicalAgentSchema.safeParse(invalid).success).toBe(false);
  });
});
