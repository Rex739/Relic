import { describe, expect, it } from "vitest";

import type {
  Mandate,
  PublicMarketplaceAgentDetail,
  VerifiedMandateProfile,
} from "../src/index.js";
import {
  assertExecutionAuthorized,
  humanReadableMandate,
  mandateProfileForAgent,
  validateMandateConfiguration,
} from "../src/index.js";

const now = new Date("2026-08-21T12:00:00.000Z");
const actionableAgent = (
  overrides: Partial<PublicMarketplaceAgentDetail> = {},
) =>
  ({
    id: "01945b1e-7e80-7000-8000-000000000003",
    name: "Relic Health Factor Monitor",
    description:
      "Read-only Venus position monitoring and health factor alerts.",
    category: "health-factor-monitoring",
    tier: "Actionable",
    availability: "available",
    chainId: 97,
    network: "BNB Chain Testnet",
    registryAddress: "0x1111111111111111111111111111111111111111",
    externalAgentId: "1840",
    supplyType: "relic_reference",
    capabilities: ["health-factor-monitoring"],
    protocols: ["Venus", "erc8183"],
    interfaces: ["erc8183"],
    pricingKnown: true,
    activeOfferPrice: {
      amountBaseUnits: "0",
      decimals: 18,
      symbol: "tBNB",
      tokenAddress: "0x0000000000000000000000000000000000000000",
    },
    hireable: true,
    verifiedInvocationCount: 1,
    completedCommerceJobCount: 0,
    deliveryCompletedCount: 0,
    settlementCompletedCount: 0,
    unsuccessfulCommerceJobCount: 0,
    feedbackCount: 0,
    lastVerifiedAt: "2026-08-21T10:00:00.000Z",
    updatedAt: "2026-08-21T10:00:00.000Z",
    ownerAddress: "0x2222222222222222222222222222222222222222",
    metadataUri: "ipfs://health-monitor",
    registrationTransaction: null,
    registrationBlock: "126223200",
    services: [
      {
        id: "01945b1e-7e80-7000-8000-000000001003",
        name: "Health factor analysis",
        description: "Read-only health factor analysis",
        interface: "erc8183",
        endpoint: "https://example.test/erc8183",
        availability: "available",
        verificationLevel: "INVOCATION_VERIFIED",
        pricing: { amount: "0" },
        protocolSupport: { Venus: true },
        lastVerifiedAt: "2026-08-21T10:00:00.000Z",
        provenance: "independently_observed",
      },
    ],
    evidence: [],
    outcomes: [],
    surfacedBecause: ["protocol: Venus"],
    checks: {
      identityVerified: true,
      endpointReachable: true,
      protocolVerified: true,
      invocationVerified: true,
      commerceVerified: true,
      lastCheckedAt: "2026-08-21T10:00:00.000Z",
    },
    ...overrides,
  }) satisfies PublicMarketplaceAgentDetail;

const profile = mandateProfileForAgent(actionableAgent(), now);
const request = {
  agentId: actionableAgent().id,
  chainId: 97 as const,
  objective:
    "Monitor my Venus lending position and alert below health factor 1.30.",
  allowedCapabilities: [
    "monitor_positions",
    "calculate_health_factor",
    "generate_alerts",
  ],
  deniedCapabilities: [
    "transfer_tokens",
    "borrow_assets",
    "repay_debt",
    "swap_assets",
    "approve_contracts",
    "submit_transactions",
  ],
  allowedAssets: [],
  allowedProtocols: ["Venus"],
  allowedContracts: [],
  perActionLimit: null,
  aggregateLimit: null,
  executionFrequency: null,
  startAt: now.toISOString(),
  expiresAt: "2026-08-28T12:00:00.000Z",
  approvalMode: "OBSERVE_ONLY" as const,
  riskConstraints: { alertHealthFactorBelow: "1.30" },
  stopConditions: [{ kind: "SERVICE_STALE" }],
};

describe("evidence-bound mandates", () => {
  it("permits the verified read-only Health Factor profile with minimal authority", () => {
    expect(profile).toMatchObject({
      tier: "Actionable",
      chainId: 97,
      approvalModes: ["OBSERVE_ONLY"],
      transactional: false,
      current: true,
    });
    expect(validateMandateConfiguration(request, profile, now)).toMatchObject({
      approvalMode: "OBSERVE_ONLY",
      allowedAssets: [],
      allowedProtocols: ["Venus"],
    });
  });

  it("rejects Working, stale, network-mismatched, unsupported, and escalated activation", () => {
    expect(() =>
      mandateProfileForAgent(actionableAgent({ tier: "Working" }), now),
    ).toThrow(/Only Actionable/);
    const stale = mandateProfileForAgent(
      actionableAgent({
        lastVerifiedAt: "2026-08-01T00:00:00.000Z",
        services: [
          {
            ...actionableAgent().services[0]!,
            lastVerifiedAt: "2026-08-01T00:00:00.000Z",
          },
        ],
      }),
      now,
    );
    expect(() => validateMandateConfiguration(request, stale, now)).toThrow(
      /stale or unavailable/,
    );
    expect(() =>
      validateMandateConfiguration({ ...request, chainId: 56 }, profile, now),
    ).toThrow(/network/);
    expect(() =>
      validateMandateConfiguration(
        { ...request, allowedCapabilities: ["transfer_tokens"] },
        profile,
        now,
      ),
    ).toThrow(/not been verified/);
    expect(() =>
      validateMandateConfiguration(
        { ...request, allowedAssets: ["USDT"] },
        profile,
        now,
      ),
    ).toThrow(/asset/);
    expect(() =>
      validateMandateConfiguration(
        { ...request, allowedProtocols: ["PancakeSwap"] },
        profile,
        now,
      ),
    ).toThrow(/protocol/);
  });

  it("enforces expiry and amount limits before execution", () => {
    const executionProfile: VerifiedMandateProfile = {
      ...profile,
      capabilitySet: ["swap_assets"],
      supportedAssets: ["USDT"],
      approvalModes: ["ASK_BEFORE_EXECUTION"],
      transactional: true,
    };
    const mandate = {
      id: "01945b1e-7e80-7000-8000-000000000100",
      principalId: "01945b1e-7e80-7000-8000-000000000101",
      principalType: "DEVELOPMENT_SESSION",
      agentId: profile.agentId,
      chainId: 97,
      status: "ACTIVE",
      authorizationBoundary: "POLICY_ONLY",
      currentVersion: 1,
      activeVersion: 1,
      attentionReason: null,
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
      events: [],
      version: {
        id: "01945b1e-7e80-7000-8000-000000000102",
        mandateId: "01945b1e-7e80-7000-8000-000000000100",
        version: 1,
        state: "ACTIVE",
        objective: "Swap only USDT within deterministic limits.",
        allowedCapabilities: ["swap_assets"],
        deniedCapabilities: [],
        allowedAssets: ["USDT"],
        allowedProtocols: [],
        allowedContracts: [],
        perActionLimit: { asset: "USDT", amount: "50" },
        aggregateLimit: { asset: "USDT", amount: "200" },
        executionFrequency: { maxActions: 1, windowSeconds: 3600 },
        startAt: now.toISOString(),
        expiresAt: "2026-08-28T12:00:00.000Z",
        approvalMode: "ASK_BEFORE_EXECUTION",
        riskConstraints: {},
        stopConditions: [],
        createdAt: now.toISOString(),
        approvedAt: now.toISOString(),
        activatedAt: now.toISOString(),
        supersededAt: null,
        evidence: {
          agentId: profile.agentId,
          externalAgentId: "1840",
          registryAddress: "0x1111111111111111111111111111111111111111",
          serviceId: profile.serviceId,
          serviceEndpoint: profile.serviceEndpoint,
          verificationTier: "Actionable",
          verificationTimestamp: profile.verificationTimestamp,
          chainId: 97,
          capabilitySet: ["swap_assets"],
          evidenceSnapshot: {},
        },
      },
    } satisfies Mandate;
    expect(() =>
      assertExecutionAuthorized({
        mandate,
        profile: executionProfile,
        capability: "swap_assets",
        asset: "USDT",
        amount: "51",
        now,
      }),
    ).toThrow(/per-action/);
    expect(() =>
      assertExecutionAuthorized({
        mandate,
        profile: executionProfile,
        capability: "swap_assets",
        asset: "USDT",
        amount: "30",
        aggregateUsed: "180",
        now,
      }),
    ).toThrow(/aggregate/);
    expect(() =>
      assertExecutionAuthorized({
        mandate: { ...mandate, status: "PAUSED" },
        profile: executionProfile,
        capability: "swap_assets",
        now,
      }),
    ).toThrow(/cannot authorize/);
    expect(() =>
      assertExecutionAuthorized({
        mandate: { ...mandate, status: "REVOKED" },
        profile: executionProfile,
        capability: "swap_assets",
        now,
      }),
    ).toThrow(/cannot authorize/);
    expect(() =>
      assertExecutionAuthorized({
        mandate,
        profile: executionProfile,
        capability: "swap_assets",
        now: new Date("2026-08-29T00:00:00.000Z"),
      }),
    ).toThrow(/expired/);
  });

  it("derives preview prose only from the structured mandate", () => {
    expect(
      humanReadableMandate(actionableAgent().name, actionableAgent().network, {
        ...request,
        allowedCapabilities: request.allowedCapabilities,
      }),
    ).toMatchObject({
      may: ["monitor positions", "calculate health factor", "generate alerts"],
      assets: ["No asset spending authority"],
      protocols: ["Venus"],
      approvalMode: "OBSERVE_ONLY",
      network: "BNB Chain Testnet",
      revocable: true,
    });
  });
});
