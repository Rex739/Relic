import type { AgentSubmission, RegistryAgentRecord } from "@relic/domain";
import { describe, expect, it, vi } from "vitest";

import { onboardVerifiedSellerSubmission } from "../src/seller-onboarding.js";

const submission: AgentSubmission = {
  id: "01945b1e-7e80-7000-8000-000000000071",
  chainId: 97,
  registryAddress: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  externalAgentId: "2016",
  supplyType: "third_party",
  relicPrincipalId: "seller-principal",
  status: "SUBMITTED",
  submitterAddress: "0x1111111111111111111111111111111111111111",
  ownershipVerifiedAt: "2026-08-31T10:00:00.000Z",
  agentId: null,
  candidateId: null,
  developerOverrides: {},
  createdAt: "2026-08-31T10:00:00.000Z",
  updatedAt: "2026-08-31T10:00:00.000Z",
};

const record: RegistryAgentRecord = {
  source: "erc-8004:eip155:97:0x8004A818BFB912233c491871b3d84c89A494BD9e",
  chainId: 97,
  registryAddress: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  agentId: "2016",
  ownerAddress: "0x1111111111111111111111111111111111111111",
  metadataUri: "https://agent.example/metadata.json",
  metadata: {
    name: "Yield Scout",
    description: "Find yield optimisation opportunities.",
    services: [
      {
        name: "Yield optimisation",
        endpoint: "https://agent.example/a2a",
      },
    ],
  },
  metadataResolution: { status: "resolved" },
  registrationTransaction: null,
  registrationBlock: null,
  registeredAt: null,
  fetchedAt: "2026-08-31T10:00:00.000Z",
  raw: {},
};

describe("seller onboarding worker", () => {
  it("catalogues an ownership-verified agent and queues a bounded service check", async () => {
    const transitionTargets: AgentSubmission["status"][] = [];
    const transitionSubmission = vi.fn(
      (input: { to: AgentSubmission["status"] }) => {
        transitionTargets.push(input.to);
        return Promise.resolve();
      },
    );
    const createOnboardingCandidate = vi.fn().mockResolvedValue("candidate-1");
    const materialize = vi.fn().mockResolvedValue({
      candidates: 1,
      identitiesVerified: 0,
      services: 1,
      serviceIdentified: 1,
    });
    const provider = { getAgent: vi.fn().mockResolvedValue(record) };

    const result = await onboardVerifiedSellerSubmission(
      {
        onboarding: {
          findSubmission: vi.fn().mockResolvedValue(submission),
          listPendingCatalogSubmissions: vi.fn().mockResolvedValue([]),
          transitionSubmission,
        },
        supplyStore: { createOnboardingCandidate } as never,
        writer: { persist: vi.fn().mockResolvedValue("agent-1") },
        providerFor: vi.fn().mockReturnValue(provider),
        materialize,
      },
      submission.id,
    );

    expect(result).toMatchObject({
      state: "catalogued",
      agentId: "agent-1",
      candidateId: "candidate-1",
    });
    expect(createOnboardingCandidate).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "agent-1",
        categorySlug: "yield-optimisation",
      }),
    );
    expect(transitionTargets).toEqual([
      "IDENTITY_CHECK",
      "METADATA_CHECK",
      "SERVICE_DISCOVERY",
      "SERVICE_VERIFICATION",
    ]);
  });

  it("does nothing until ownership has been verified", async () => {
    const getAgent = vi.fn();
    const result = await onboardVerifiedSellerSubmission(
      {
        onboarding: {
          findSubmission: vi
            .fn()
            .mockResolvedValue({ ...submission, ownershipVerifiedAt: null }),
          listPendingCatalogSubmissions: vi.fn().mockResolvedValue([]),
          transitionSubmission: vi.fn(),
        },
        supplyStore: {} as never,
        writer: {} as never,
        providerFor: vi.fn().mockReturnValue({ getAgent }),
      },
      submission.id,
    );

    expect(result).toEqual({ state: "skipped" });
    expect(getAgent).not.toHaveBeenCalled();
  });

  it("recovers a verified submission whose service catalog was interrupted", async () => {
    const createOnboardingCandidate = vi.fn();
    const materialize = vi.fn().mockResolvedValue({
      candidates: 1,
      identitiesVerified: 0,
      services: 1,
      serviceIdentified: 1,
    });
    const result = await onboardVerifiedSellerSubmission(
      {
        onboarding: {
          findSubmission: vi.fn().mockResolvedValue({
            ...submission,
            status: "SERVICE_VERIFICATION",
            agentId: "agent-1",
            candidateId: "candidate-1",
          }),
          listPendingCatalogSubmissions: vi.fn().mockResolvedValue([]),
          transitionSubmission: vi.fn(),
        },
        supplyStore: { createOnboardingCandidate } as never,
        writer: { persist: vi.fn().mockResolvedValue("agent-1") },
        providerFor: vi.fn().mockReturnValue({
          getAgent: vi.fn().mockResolvedValue(record),
        }),
        materialize,
      },
      submission.id,
    );

    expect(result).toMatchObject({
      state: "catalogued",
      agentId: "agent-1",
      candidateId: "candidate-1",
    });
    expect(createOnboardingCandidate).not.toHaveBeenCalled();
    expect(materialize).toHaveBeenCalledOnce();
  });
});
