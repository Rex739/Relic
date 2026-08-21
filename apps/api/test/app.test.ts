import type {
  AgentSubmission,
  AgentDetail,
  AgentReadRepository,
  MarketplaceService,
  OnboardingRepository,
  OwnershipChallenge,
  PublicMarketplaceAgent,
} from "@relic/domain";
import { agentListResponseSchema } from "@relic/validation";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";

const repository: AgentReadRepository = {
  list: () => Promise.resolve({ items: [], nextCursor: null }),
  findById: () => Promise.resolve(null),
};
const app = createApp(repository);
const publicAgent: PublicMarketplaceAgent = {
  id: "01945b1e-7e80-7000-8000-000000000099",
  name: "Verified fixture",
  description: "A fixture that represents an independently invoked agent.",
  category: "rebalancing",
  tier: "Working",
  availability: "available",
  chainId: 56,
  network: "BNB Chain",
  registryAddress: "0xregistry",
  externalAgentId: "99",
  supplyType: "third_party",
  capabilities: ["rebalancing"],
  protocols: ["a2a"],
  interfaces: ["a2a"],
  pricingKnown: false,
  executionEvidenceCount: 1,
  feedbackCount: 0,
  lastVerifiedAt: "2026-08-20T00:00:00.000Z",
  updatedAt: "2026-08-20T00:00:00.000Z",
};

describe("Relic API", () => {
  it("reports health", async () => {
    const response = await app.request("/health");
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      status: "ok",
      service: "relic-api",
    });
  });

  it("reports explicit corpus readiness and forwards the validated chain", async () => {
    let chain = 0;
    const statusApp = createApp({
      list: () => Promise.resolve({ items: [], nextCursor: null }),
      findById: () => Promise.resolve(null),
      corpusStatus: (chainId) => {
        chain = chainId;
        return Promise.resolve({
          chainId,
          readyForFullIngestion: true,
          fullIngestionComplete: false,
          checkpoint: { operationalMode: "anonymous" },
        });
      },
    });
    const response = await statusApp.request(
      "/internal/corpus-status?chainId=56",
    );
    expect(response.status).toBe(200);
    expect(chain).toBe(56);
    await expect(response.json()).resolves.toMatchObject({
      data: {
        readyForFullIngestion: true,
        fullIngestionComplete: false,
        checkpoint: { operationalMode: "anonymous" },
      },
    });
  });

  it("returns a validated paginated agent response", async () => {
    const response = await app.request("/v1/agents?limit=10");
    expect(response.status).toBe(200);
    expect(
      agentListResponseSchema.safeParse(await response.json()).success,
    ).toBe(true);
  });

  it("returns a consistent not-found error", async () => {
    const response = await app.request(
      "/v1/agents/01945b1e-7e80-7000-8000-000000000001",
    );
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toEqual({
      error: { code: "agent_not_found", message: "Agent not found" },
    });
  });

  it("rejects malformed pagination", async () => {
    const response = await app.request("/v1/agents?limit=500");
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_error", message: "Invalid request" },
    });
  });

  it("passes only validated corpus filters to the repository", async () => {
    let captured: unknown;
    const filtered = createApp({
      list: (query) => {
        captured = query;
        return Promise.resolve({ items: [], nextCursor: null });
      },
      findById: () => Promise.resolve(null),
    });
    const response = await filtered.request(
      "/v1/agents?limit=5&category=grid-trading&capability=grid-trading&interface=mcp&readiness=DISCOVERABLE&verificationStatus=verified",
    );
    expect(response.status).toBe(200);
    expect(captured).toMatchObject({
      category: "grid-trading",
      capability: "grid-trading",
      interface: "mcp",
      readiness: "DISCOVERABLE",
      verificationStatus: "verified",
    });
  });

  it("uses a separate server-enforced public marketplace repository", async () => {
    let captured: unknown;
    const marketplace = createApp({
      list: () => Promise.resolve({ items: [], nextCursor: null }),
      findById: () => Promise.resolve(null),
      listPublicMarketplace: (query) => {
        captured = query;
        return Promise.resolve({
          items: [publicAgent],
          page: query.page,
          limit: query.limit,
          total: 1,
          totalPages: 1,
        });
      },
    });
    const response = await marketplace.request(
      "/v1/marketplace/agents?category=rebalancing&protocol=a2a&tier=Working&chainId=56&page=1&limit=12",
    );
    expect(response.status).toBe(200);
    expect(captured).toMatchObject({
      category: "rebalancing",
      protocol: "a2a",
      tier: "Working",
      chainId: 56,
    });
    await expect(response.json()).resolves.toMatchObject({
      data: [{ name: "Verified fixture", tier: "Working" }],
      pagination: { total: 1 },
    });
  });

  it("returns 404 for a corpus identity that is not publicly eligible", async () => {
    const id = "01945b1e-7e80-7000-8000-000000000001";
    const marketplace = createApp({
      list: () => Promise.resolve({ items: [], nextCursor: null }),
      findById: () => Promise.resolve({} as AgentDetail),
      findPublicMarketplaceAgent: () => Promise.resolve(null),
    });
    const response = await marketplace.request(`/v1/marketplace/agents/${id}`);
    expect(response.status).toBe(404);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "marketplace_agent_not_found" },
    });
  });

  it("omits non-public IDs from comparison", async () => {
    const marketplace = createApp({
      list: () => Promise.resolve({ items: [], nextCursor: null }),
      findById: () => Promise.resolve(null),
      comparePublicMarketplaceAgents: () => Promise.resolve([publicAgent]),
    });
    const response = await marketplace.request(
      `/v1/marketplace/compare?ids=${publicAgent.id},01945b1e-7e80-7000-8000-000000000001`,
    );
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id: publicAgent.id }],
    });
  });

  it("lists real service records through explicit service filters", async () => {
    let captured: unknown;
    const id = "01945b1e-7e80-7000-8000-000000000001";
    const service: MarketplaceService = {
      id,
      agentId: id,
      sourceServiceId: "declaration:real-1",
      name: "Observed service",
      description: null,
      capability: null,
      category: "grid-trading",
      interface: "mcp",
      endpoint: "https://example.com/mcp",
      httpMethod: null,
      inputSchema: null,
      outputSchema: null,
      pricing: null,
      currencyToken: null,
      networkChainId: null,
      sla: null,
      authenticationRequirements: null,
      protocolSupport: { mcp: true },
      availability: "available",
      verificationLevel: "ENDPOINT_OBSERVED",
      lastVerifiedAt: "2026-08-14T00:00:00.000Z",
      source: "direct-registration-file",
      provenance: "developer_declared",
      updatedAt: "2026-08-14T00:00:00.000Z",
    };
    const services = createApp({
      list: () => Promise.resolve({ items: [], nextCursor: null }),
      findById: () => Promise.resolve({} as AgentDetail),
      listAgentServices: (_agentId, query) => {
        captured = query;
        return Promise.resolve([service]);
      },
      findService: () => Promise.resolve(service),
    });
    const response = await services.request(
      `/v1/agents/${id}/services?interface=mcp&actionable=false`,
    );
    expect(response.status).toBe(200);
    expect(captured).toEqual({ interface: "mcp", actionable: false });
    await expect(response.json()).resolves.toMatchObject({
      data: [{ id, interface: "mcp" }],
    });
    expect((await services.request(`/v1/services/${id}`)).status).toBe(200);
  });

  it("accepts reusable third-party submissions and verifies a signed owner challenge", async () => {
    const owner = privateKeyToAccount(
      "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
    );
    let submission: AgentSubmission | null = null;
    let challenge: OwnershipChallenge | null = null;
    const onboarding: OnboardingRepository = {
      createSubmission: (input) => {
        submission = {
          id: "01945b1e-7e80-7000-8000-000000000020",
          chainId: input.chainId,
          externalAgentId: input.externalAgentId,
          supplyType: input.supplyType,
          status: "SUBMITTED",
          submitterAddress: input.submitterAddress ?? null,
          ownershipVerifiedAt: null,
          agentId: null,
          candidateId: null,
          developerOverrides: input.developerOverrides ?? {},
          createdAt: "2026-08-14T00:00:00.000Z",
          updatedAt: "2026-08-14T00:00:00.000Z",
        };
        return Promise.resolve(submission);
      },
      findSubmission: () => Promise.resolve(submission),
      findOwnershipContext: () =>
        Promise.resolve({
          registryAddress: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
          ownerAddress: owner.address,
        }),
      createOwnershipChallenge: (input) => {
        challenge = {
          id: "01945b1e-7e80-7000-8000-000000000021",
          submissionId: input.submissionId,
          message: input.message,
          expectedOwner: input.expectedOwner,
          expiresAt: input.expiresAt.toISOString(),
        };
        return Promise.resolve(challenge);
      },
      findOwnershipChallenge: () => Promise.resolve(challenge),
      consumeOwnershipChallenge: (input) => {
        if (submission !== null)
          submission = {
            ...submission,
            ownershipVerifiedAt: input.verifiedAt.toISOString(),
          };
        return Promise.resolve(true);
      },
    };
    const onboardingApp = createApp(repository, onboarding);
    const created = await onboardingApp.request("/v1/agent-submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chainId: 97,
        externalAgentId: "42",
        submitterAddress: owner.address,
      }),
    });
    expect(created.status).toBe(201);
    await expect(created.json()).resolves.toMatchObject({
      data: { supplyType: "third_party", status: "SUBMITTED" },
    });
    const challenged = await onboardingApp.request(
      "/v1/agent-submissions/01945b1e-7e80-7000-8000-000000000020/ownership-challenges",
      { method: "POST" },
    );
    expect(challenged.status).toBe(201);
    const challengeBody = (await challenged.json()) as {
      data: { id: string; message: string };
    };
    const signature = await owner.signMessage({
      message: challengeBody.data.message,
    });
    const verified = await onboardingApp.request(
      "/v1/agent-submissions/01945b1e-7e80-7000-8000-000000000020/ownership-verification",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ challengeId: challengeBody.data.id, signature }),
      },
    );
    expect(verified.status).toBe(200);
    await expect(verified.json()).resolves.toEqual({
      data: { verified: true },
    });
  });

  it("does not let public submitters self-assign partner or reference supply", async () => {
    const response = await createApp(repository, {
      createSubmission: () => Promise.reject(new Error("must not be called")),
      findSubmission: () => Promise.resolve(null),
      findOwnershipContext: () => Promise.resolve(null),
      findOwnershipChallenge: () => Promise.resolve(null),
      createOwnershipChallenge: () => Promise.reject(new Error("unused")),
      consumeOwnershipChallenge: () => Promise.resolve(false),
    }).request("/v1/agent-submissions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chainId: 97,
        externalAgentId: "42",
        submitterAddress: "0x1111111111111111111111111111111111111111",
        supplyType: "relic_reference",
      }),
    });
    expect(response.status).toBe(400);
  });
});
