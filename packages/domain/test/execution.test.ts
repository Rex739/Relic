import { randomUUID } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  CanonicalExecutionAction,
  Mandate,
  VerifiedMandateProfile,
} from "../src/index.js";
import { evaluateExecutionPolicy, normalizedActionHash } from "../src/index.js";

const now = new Date("2026-08-21T12:00:00.000Z");
const profile: VerifiedMandateProfile = {
  agentId: "01945b1e-7e80-7000-8000-000000000003",
  agentName: "Relic Health Factor Monitor",
  tier: "Actionable",
  chainId: 97,
  network: "BNB Chain Testnet",
  serviceId: "01945b1e-7e80-7000-8000-000000000004",
  serviceEndpoint: "https://example.test/erc8183",
  serviceVerificationLevel: "INVOCATION_VERIFIED",
  verificationTimestamp: now.toISOString(),
  capabilitySet: [
    "monitor_positions",
    "calculate_health_factor",
    "generate_alerts",
  ],
  supportedAssets: [],
  supportedProtocols: ["Venus"],
  supportedContracts: [],
  approvalModes: ["OBSERVE_ONLY"],
  transactional: false,
  current: true,
  attentionReason: null,
};
const mandate: Mandate = {
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
    objective: "Observe my Venus position under a read-only policy.",
    allowedCapabilities: profile.capabilitySet,
    deniedCapabilities: ["transfer_tokens", "borrow_assets", "swap_assets"],
    allowedAssets: [],
    allowedProtocols: ["Venus"],
    allowedContracts: [],
    perActionLimit: null,
    aggregateLimit: null,
    executionFrequency: { maxActions: 3, windowSeconds: 3600 },
    startAt: now.toISOString(),
    expiresAt: "2026-08-28T12:00:00.000Z",
    approvalMode: "OBSERVE_ONLY",
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
      capabilitySet: profile.capabilitySet,
      evidenceSnapshot: {},
    },
  },
};
const action = (
  overrides: Partial<CanonicalExecutionAction> = {},
): CanonicalExecutionAction => {
  const request = {
    mandateId: mandate.id,
    mandateVersion: 1,
    agentId: profile.agentId,
    chainId: 97 as const,
    actionType: "observe_venus_position",
    capability: "monitor_positions",
    protocol: "Venus",
    target: null,
    asset: null,
    amount: null,
    destination: null,
    parameters: { account: "0x2222222222222222222222222222222222222222" },
    deadline: "2026-08-21T13:00:00.000Z",
    source: {},
  };
  return {
    ...request,
    id: randomUUID(),
    principalId: mandate.principalId,
    requestedAt: now.toISOString(),
    normalizedHash: normalizedActionHash(request, mandate.principalId),
    transactional: false,
    ...overrides,
  };
};
const budget = {
  committedAmount: "0",
  succeededAmount: "0",
  releasedAmount: "0",
  periodActionCount: 0,
};

describe("deterministic execution policy", () => {
  it("allows the verified read-only observation without implying signing authority", () => {
    expect(
      evaluateExecutionPolicy({
        mandate,
        profile,
        action: action(),
        budget,
        now,
      }),
    ).toMatchObject({
      decision: "ALLOW",
      signingAuthorization: false,
    });
  });

  it("denies financial escalation, network substitution, paused/revoked state, and stale service", () => {
    const financial = action({
      capability: "transfer_tokens",
      actionType: "transfer_tokens",
      asset: "USDT",
      amount: "50",
      transactional: true,
    });
    expect(
      evaluateExecutionPolicy({
        mandate,
        profile,
        action: financial,
        budget,
        now,
      }).decision,
    ).toBe("DENY");
    expect(
      evaluateExecutionPolicy({
        mandate,
        profile,
        action: action({ chainId: 56 }),
        budget,
        now,
      }).reasons,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "network_mismatch" }),
      ]),
    );
    for (const status of ["PAUSED", "REVOKED"] as const)
      expect(
        evaluateExecutionPolicy({
          mandate: { ...mandate, status },
          profile,
          action: action(),
          budget,
          now,
        }).decision,
      ).toBe("DENY");
    expect(
      evaluateExecutionPolicy({
        mandate,
        profile: {
          ...profile,
          current: false,
          attentionReason: "Endpoint stale",
        },
        action: action(),
        budget,
        now,
      }).reasons,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "stale_agent" }),
      ]),
    );
  });

  it("binds approvals to the normalized action and requires approval for transactional ASK mode", () => {
    const askMandate: Mandate = {
      ...mandate,
      version: {
        ...mandate.version,
        approvalMode: "ASK_BEFORE_EXECUTION",
        allowedCapabilities: ["swap_assets"],
        deniedCapabilities: [],
        allowedAssets: ["USDT"],
        perActionLimit: { asset: "USDT", amount: "100" },
        aggregateLimit: { asset: "USDT", amount: "200" },
      },
    };
    const askProfile = {
      ...profile,
      capabilitySet: ["swap_assets"],
      supportedAssets: ["USDT"],
      approvalModes: ["ASK_BEFORE_EXECUTION" as const],
      transactional: true,
    };
    const first = action({
      capability: "swap_assets",
      asset: "USDT",
      amount: "50",
      transactional: true,
    });
    const altered = { ...first, amount: "51" };
    altered.normalizedHash = normalizedActionHash(altered, mandate.principalId);
    expect(
      evaluateExecutionPolicy({
        mandate: askMandate,
        profile: askProfile,
        action: first,
        budget,
        now,
      }).decision,
    ).toBe("REQUIRE_APPROVAL");
    expect(altered.normalizedHash).not.toBe(first.normalizedHash);
    expect(
      evaluateExecutionPolicy({
        mandate: askMandate,
        profile: askProfile,
        action: action({
          capability: "swap_assets",
          asset: "USDT",
          amount: "50",
          transactional: true,
        }),
        budget: { ...budget, committedAmount: "175" },
        now,
      }).reasons,
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: "aggregate_limit_exceeded" }),
      ]),
    );
  });
});
