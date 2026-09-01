import { z } from "zod";

import type { TokenAmount } from "./money.js";

export type PublicVerificationTier = "Working" | "Actionable" | "Proven";

export type MarketplaceReviewSentiment = "GOOD" | "BAD";
export type MarketplaceReviewRole = "BUYER" | "AGENT";
export type MarketplaceReviewSubjectType = "AGENT" | "BUYER";

export interface MarketplaceReview {
  id: string;
  activationId: string;
  reviewerRole: MarketplaceReviewRole;
  subjectType: MarketplaceReviewSubjectType;
  sentiment: MarketplaceReviewSentiment;
  tags: string[];
  message: string | null;
  createdAt: string;
}

export interface MarketplaceReviewSummary {
  total: number;
  good: number;
  bad: number;
}

export const marketplaceReviewTags = {
  BUYER: {
    GOOD: [
      "accurate-result",
      "clear-output",
      "fast-response",
      "good-value",
      "reliable",
      "worked-as-expected",
    ],
    BAD: [
      "slow-response",
      "incorrect-result",
      "didnt-follow-instructions",
      "poor-output",
      "service-issue",
      "other",
    ],
  },
  AGENT: {
    GOOD: [
      "clear-request",
      "valid-setup",
      "smooth-transaction",
      "good-parameters",
      "easy-to-work-with",
    ],
    BAD: [
      "invalid-request",
      "conflicting-instructions",
      "repeated-cancellation",
      "poor-parameters",
      "transaction-issue",
    ],
  },
} as const;

export function isMarketplaceReviewTag(input: {
  role: MarketplaceReviewRole;
  sentiment: MarketplaceReviewSentiment;
  tag: string;
}) {
  return (
    marketplaceReviewTags[input.role][input.sentiment] as readonly string[]
  ).includes(input.tag);
}

export interface PublicMarketplaceQuery {
  readonly page: number;
  readonly limit: number;
  readonly text?: string | undefined;
  readonly requirements?: string[] | undefined;
  readonly category?: string | undefined;
  readonly protocol?: string | undefined;
  readonly tier?: PublicVerificationTier | undefined;
  readonly chainId?: 56 | 97 | undefined;
  readonly interface?: string | undefined;
  readonly pricingKnown?: boolean | undefined;
  readonly hasReputation?: boolean | undefined;
}

export interface PublicMarketplaceAgent {
  id: string;
  name: string;
  description: string;
  imageUrl: string | null;
  category: string;
  tier: PublicVerificationTier;
  availability: "available";
  chainId: 56 | 97;
  network: "BNB Chain" | "BNB Chain Testnet";
  registryAddress: string;
  externalAgentId: string;
  supplyType: "third_party" | "partner" | "relic_reference";
  capabilities: string[];
  protocols: string[];
  interfaces: string[];
  pricingKnown: boolean;
  activeOfferPrice: {
    amountBaseUnits: string;
    decimals: number;
    symbol: string;
    tokenAddress: string;
  } | null;
  hireable: boolean;
  verifiedInvocationCount: number;
  eligibleAcceptedJobCount: number;
  completedCommerceJobCount: number;
  completionRatePercent: number | null;
  reviewCount: number;
  reviewGoodCount: number;
  reviewBadCount: number;
  deliveryCompletedCount: number;
  settlementCompletedCount: number;
  unsuccessfulCommerceJobCount: number;
  feedbackCount: number;
  lastVerifiedAt: string;
  updatedAt: string;
}

export function completionRateStats(input: {
  eligibleAcceptedJobs: number;
  successfullyCompletedJobs: number;
}) {
  if (
    !Number.isInteger(input.eligibleAcceptedJobs) ||
    !Number.isInteger(input.successfullyCompletedJobs) ||
    input.eligibleAcceptedJobs < 0 ||
    input.successfullyCompletedJobs < 0 ||
    input.successfullyCompletedJobs > input.eligibleAcceptedJobs
  )
    throw new Error("Invalid completion-rate history");
  return {
    eligibleAcceptedJobCount: input.eligibleAcceptedJobs,
    completedCommerceJobCount: input.successfullyCompletedJobs,
    completionRatePercent:
      input.eligibleAcceptedJobs === 0
        ? null
        : Math.round(
            (input.successfullyCompletedJobs / input.eligibleAcceptedJobs) *
              100,
          ),
  };
}

export interface PublicMarketplaceResult {
  items: PublicMarketplaceAgent[];
  page: number;
  limit: number;
  total: number;
  totalPages: number;
}

export interface PublicMarketplaceService {
  id: string;
  name: string;
  description: string | null;
  interface: string;
  endpoint: string;
  availability: "available";
  verificationLevel: "INVOCATION_VERIFIED" | "COMMERCE_VERIFIED";
  pricing: unknown;
  protocolSupport: Record<string, unknown>;
  lastVerifiedAt: string;
  provenance: string;
}

export interface PublicMarketplaceEvidence {
  fieldPath: string;
  label: string;
  provenance: string;
  source: string;
  sourceUri: string | null;
  observedAt: string;
}

export interface PublicMarketplaceOutcome {
  invocationSuccessful: boolean;
  commerceSuccessful: boolean;
  executionDurationMs: number | null;
  responseStatus: string | null;
  deliveredAt: string | null;
  settlementState: string;
  observedCost: string;
  observedAt: string;
}

export interface PublicMarketplaceAgentDetail extends PublicMarketplaceAgent {
  ownerAddress: string;
  metadataUri: string;
  registrationTransaction: string | null;
  registrationBlock: string | null;
  services: PublicMarketplaceService[];
  evidence: PublicMarketplaceEvidence[];
  outcomes: PublicMarketplaceOutcome[];
  reviews: MarketplaceReview[];
  surfacedBecause: string[];
  checks: {
    identityVerified: boolean;
    endpointReachable: boolean;
    protocolVerified: boolean;
    invocationVerified: boolean;
    commerceVerified: boolean;
    lastCheckedAt: string;
  };
}

export interface PublicCategoryCount {
  slug: string;
  label: string;
  discovered: number;
  verified: number;
  ready: number;
  hireable: number;
  working: number;
  actionable: number;
  protocols: string[];
}

export type SellerReadinessState = "complete" | "attention" | "blocked";

export const sellerMarketplaceProfileInputSchema = z
  .object({
    description: z.string().trim().min(20).max(2_000),
    imageUrl: z
      .union([
        z.url().max(2_048),
        z
          .string()
          .regex(
            /^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/,
            "Profile image must be a JPEG upload",
          )
          .max(2_800_000),
        z.literal(""),
      ])
      .transform((value) => (value === "" ? null : value)),
  })
  .strict();
export type SellerMarketplaceProfileInput = z.infer<
  typeof sellerMarketplaceProfileInputSchema
>;

export interface SellerMarketplaceProfile extends SellerMarketplaceProfileInput {
  agentId: string;
  updatedByPrincipalId: string;
  updatedAt: string;
}

export interface SellerReadinessRequirement {
  state: SellerReadinessState;
  label: string;
  explanation: string;
  nextAction: string | null;
}

export interface SellerAgentReadiness {
  agentId: string;
  serviceId: string | null;
  serviceEndpoint?: string | null;
  name: string;
  description: string;
  imageUrl: string | null;
  category: string;
  chainId: 56 | 97;
  externalAgentId: string;
  testDeployment: boolean;
  verifiedPrice: TokenAmount | null;
  latestVerification?: {
    result: "passed" | "failed" | "blocked";
    observedAt: string;
    errorMessage: string | null;
  } | null;
  requirements: {
    identity: SellerReadinessRequirement;
    service: SellerReadinessRequirement;
    verification: SellerReadinessRequirement;
    commerce: SellerReadinessRequirement;
    offer: SellerReadinessRequirement;
  };
  marketplaceStatus: "PUBLIC" | "NOT_READY";
  hireable: boolean;
  lastVerifiedAt: string | null;
  /** Present while ownership is verified but catalog setup has not finished. */
  onboardingState?: "PENDING_CATALOG_SETUP";
}

export interface SellerReadinessFacts {
  agentId: string;
  serviceId: string | null;
  serviceEndpoint?: string | null;
  name: string;
  description: string;
  imageUrl: string | null;
  category: string;
  chainId: number;
  externalAgentId: string;
  identityVerified: boolean;
  serviceAvailable: boolean;
  verificationPassed: boolean;
  lastVerifiedAt: string | null;
  commerceValidated: boolean;
  activeOffer: boolean;
  publicEligible: boolean;
  verifiedPrice: TokenAmount | null;
  latestVerification?: {
    result: "passed" | "failed" | "blocked";
    observedAt: string;
    errorMessage: string | null;
  } | null;
}

export function sellerReadinessProjection(
  facts: SellerReadinessFacts,
): SellerAgentReadiness {
  if (facts.chainId !== 56 && facts.chainId !== 97)
    throw new Error(`Unsupported seller readiness chain ${facts.chainId}`);
  const testDeployment = /test deployment|not for production use/i.test(
    `${facts.name} ${facts.description}`,
  );
  const identity: SellerReadinessRequirement = facts.identityVerified
    ? {
        state: "complete",
        label: "Agent identity verified",
        explanation:
          "Your connected wallet matches this agent's registered BNB Chain owner.",
        nextAction: null,
      }
    : {
        state: "blocked",
        label: "Agent ownership needs verification",
        explanation:
          "Relic must verify the current registered owner before seller controls are available.",
        nextAction: "Verify ownership",
      };
  const service: SellerReadinessRequirement = facts.serviceAvailable
    ? {
        state: "complete",
        label: "Service endpoint available",
        explanation: "Relic has a usable secure endpoint for this agent.",
        nextAction: null,
      }
    : {
        state: "attention",
        label: "Relic is checking the service",
        explanation:
          "Relic is safely checking the service advertised by this agent. No seller setup is required.",
        nextAction: "Relic check in progress",
      };
  const verification: SellerReadinessRequirement = facts.verificationPassed
    ? {
        state: "complete",
        label: "Verification is current",
        explanation: "Relic recently checked this service successfully.",
        nextAction: null,
      }
    : {
        state: "attention",
        label:
          facts.latestVerification?.result === "failed"
            ? "Latest verification failed"
            : facts.latestVerification?.result === "blocked"
              ? "Latest verification was blocked"
              : facts.lastVerifiedAt === null
                ? "Relic has not checked the service yet"
                : "Verification is stale",
        explanation:
          facts.latestVerification?.errorMessage ??
          (facts.lastVerifiedAt === null
            ? "Relic has not recorded a verification attempt for this service yet."
            : `The last successful verification was ${facts.lastVerifiedAt}. Relic needs a newer successful check before this service can appear to buyers.`),
        nextAction: "Waiting for a successful Relic check",
      };
  const commerce: SellerReadinessRequirement = facts.commerceValidated
    ? {
        state: "complete",
        label: "Commerce history available",
        explanation:
          "Completed buyer work is available as part of this agent's track record.",
        nextAction: null,
      }
    : {
        state: "complete",
        label: "Commerce history starts after hiring",
        explanation:
          "Buyer agreements and completed work build this agent's track record after it is available to hire.",
        nextAction: null,
      };
  const offer: SellerReadinessRequirement = facts.activeOffer
    ? {
        state: "complete",
        label: "Marketplace offer published",
        explanation: "Buyers can review current price and terms.",
        nextAction: null,
      }
    : {
        state: "blocked",
        label: "Marketplace offer not published",
        explanation:
          "The registered owner must publish current price and terms before buyers can hire this agent.",
        nextAction:
          facts.identityVerified &&
          facts.serviceAvailable &&
          facts.verificationPassed &&
          !testDeployment
            ? "Create marketplace offer"
            : "Waiting for readiness checks",
      };
  return {
    agentId: facts.agentId,
    serviceId: facts.serviceId,
    serviceEndpoint: facts.serviceEndpoint ?? null,
    name: facts.name,
    description: facts.description,
    imageUrl: facts.imageUrl,
    category: facts.category,
    chainId: facts.chainId,
    externalAgentId: facts.externalAgentId,
    testDeployment,
    verifiedPrice: facts.verifiedPrice,
    latestVerification: facts.latestVerification ?? null,
    requirements: { identity, service, verification, commerce, offer },
    marketplaceStatus:
      facts.publicEligible && !testDeployment ? "PUBLIC" : "NOT_READY",
    hireable: facts.publicEligible && facts.activeOffer && !testDeployment,
    lastVerifiedAt: facts.lastVerifiedAt,
  };
}

export interface InternalMarketplaceStatus {
  discovered: number;
  enriched: number;
  pendingEnrichment: number;
  verificationQueue: number;
  directlyVerified: number;
  serviceDeclared: number;
  invocationVerified: number;
  actionable: number;
  staleOrUnreachable: number;
  publicMarketplace: number;
  categoryCandidates: Record<string, number>;
}

export interface PublicMarketplaceRepository {
  listPublicMarketplace(
    query: PublicMarketplaceQuery,
  ): Promise<PublicMarketplaceResult>;
  findPublicMarketplaceAgent(
    id: string,
  ): Promise<PublicMarketplaceAgentDetail | null>;
  listPublicCategories(): Promise<PublicCategoryCount[]>;
  comparePublicMarketplaceAgents(
    ids: string[],
  ): Promise<PublicMarketplaceAgent[]>;
  internalMarketplaceStatus(): Promise<InternalMarketplaceStatus>;
  sellerReadiness(ownerAddress: string): Promise<SellerAgentReadiness[]>;
}
