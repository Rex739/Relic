import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { verifyIdentityToken } from "@privy-io/node";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import {
  buildOwnershipMessage,
  createOfferRequestSchema,
  sellerMarketplaceProfileInputSchema,
  createMandateRequestSchema,
  executionActionRequestSchema,
  walletChallengeRequestSchema,
  walletChallengeVerificationSchema,
  MandateValidationError,
  type AgentReadRepository,
  type AgentSubmission,
  type OnboardingRepository,
  type SellerAgentAuthorization,
  type SellerAgentReadiness,
} from "@relic/domain";
import {
  agentDetailResponseSchema,
  agentListResponseSchema,
  categoryResponseSchema,
  errorResponseSchema,
  healthResponseSchema,
  initialCategoryResponse,
  paginationQuerySchema,
  publicCategoryCountsSchema,
  publicMarketplaceDetailSchema,
  publicMarketplaceListSchema,
  publicMarketplaceQuerySchema,
  publicMarketplaceAgentSchema,
  createMarketplaceReviewSchema,
  marketplaceReviewSchema,
  serviceDetailResponseSchema,
  serviceFilterQuerySchema,
  serviceListResponseSchema,
} from "@relic/validation";
import { z } from "zod";
import { getAddress, keccak256 } from "viem";

import type { MandateApplicationService } from "./mandates.js";
import type { ExecutionApplicationService } from "./executions.js";
import type {
  CommerceApplicationService,
  WalletAuthenticationService,
} from "./commerce.js";
import type {
  Erc8004OwnershipReader,
  SellerAuthorizationGuard,
} from "./seller-ownership.js";

const json = (schema: z.ZodType, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

function pendingSellerReadiness(
  authorization: SellerAgentAuthorization,
  submission: AgentSubmission,
): SellerAgentReadiness {
  if (authorization.chainId !== 56 && authorization.chainId !== 97)
    throw new Error(
      `Unsupported seller authorization chain ${authorization.chainId}`,
    );
  return {
    // This is deliberately not a catalog agent ID. A verified ownership record
    // must not be mistaken for a service that can already be offered.
    agentId: `submission:${submission.id}`,
    serviceId: null,
    name: `Agent #${authorization.externalAgentId}`,
    description:
      "Ownership is verified. Relic is preparing this agent's catalog profile and service checks.",
    imageUrl: null,
    category: "seller-onboarding",
    chainId: authorization.chainId,
    externalAgentId: authorization.externalAgentId,
    testDeployment: false,
    verifiedPrice: null,
    requirements: {
      identity: {
        state: "complete",
        label: "Agent identity verified",
        explanation:
          "Relic confirmed control of this agent's current registered BNB Chain owner.",
        nextAction: null,
      },
      service: {
        state: "blocked",
        label: "Catalog and service setup pending",
        explanation:
          "Relic has not yet imported this agent's advertised service for marketplace checks.",
        nextAction: "Waiting for catalog setup",
      },
      verification: {
        state: "blocked",
        label: "Service verification pending",
        explanation:
          "Relic can verify the service after catalog and endpoint setup are complete.",
        nextAction: "Waiting for catalog setup",
      },
      commerce: {
        state: "blocked",
        label: "Commerce validation pending",
        explanation:
          "Commerce validation begins only after the agent has a verified service and marketplace offer.",
        nextAction: "Waiting for catalog setup",
      },
      offer: {
        state: "blocked",
        label: "Marketplace offer unavailable",
        explanation:
          "You can publish price and terms after Relic has completed catalog and service setup.",
        nextAction: "Waiting for catalog setup",
      },
    },
    marketplaceStatus: "NOT_READY",
    hireable: false,
    lastVerifiedAt: authorization.verifiedAt,
    onboardingState: "PENDING_CATALOG_SETUP",
  };
}

const healthRoute = createRoute({
  method: "get",
  path: "/health",
  responses: { 200: json(healthResponseSchema, "Service health") },
});
const listAgentsRoute = createRoute({
  method: "get",
  path: "/v1/agents",
  request: { query: paginationQuerySchema },
  responses: {
    200: json(agentListResponseSchema, "Paginated agents"),
    400: json(errorResponseSchema, "Invalid request"),
  },
});
const getAgentRoute = createRoute({
  method: "get",
  path: "/v1/agents/{id}",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: json(agentDetailResponseSchema, "Agent detail"),
    400: json(errorResponseSchema, "Invalid identifier"),
    404: json(errorResponseSchema, "Agent not found"),
  },
});
const getAgentByChainRoute = createRoute({
  method: "get",
  path: "/v1/agents/by-chain/{chainId}/{agentId}",
  request: {
    params: z.object({
      chainId: z.coerce.number().int().positive(),
      agentId: z.string().regex(/^\d+$/),
    }),
  },
  responses: {
    200: json(agentDetailResponseSchema, "Agent detail"),
    400: json(errorResponseSchema, "Invalid chain identity"),
    404: json(errorResponseSchema, "Agent not found"),
  },
});
const categoriesRoute = createRoute({
  method: "get",
  path: "/v1/categories",
  responses: {
    200: json(categoryResponseSchema, "Core Marketplace Kernel categories"),
  },
});
const dataQualityRoute = createRoute({
  method: "get",
  path: "/internal/data-quality",
  responses: {
    200: json(
      z.object({ data: z.record(z.string(), z.unknown()) }),
      "Indexer data quality",
    ),
  },
});
const corpusStatusRoute = createRoute({
  method: "get",
  path: "/internal/corpus-status",
  request: {
    query: z.object({
      chainId: z.coerce
        .number()
        .int()
        .refine((value) => value === 56 || value === 97)
        .default(56),
    }),
  },
  responses: {
    200: json(
      z.object({ data: z.record(z.string(), z.unknown()) }),
      "Corpus ingestion and verification readiness",
    ),
  },
});
const listAgentServicesRoute = createRoute({
  method: "get",
  path: "/v1/agents/{id}/services",
  request: {
    params: z.object({ id: z.uuid() }),
    query: serviceFilterQuerySchema,
  },
  responses: {
    200: json(serviceListResponseSchema, "Curated agent services"),
    400: json(errorResponseSchema, "Invalid request"),
    404: json(errorResponseSchema, "Agent not found"),
  },
});
const getServiceRoute = createRoute({
  method: "get",
  path: "/v1/services/{id}",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: json(serviceDetailResponseSchema, "Curated service detail"),
    400: json(errorResponseSchema, "Invalid request"),
    404: json(errorResponseSchema, "Service not found"),
  },
});
const publicMarketplaceRoute = createRoute({
  method: "get",
  path: "/v1/marketplace/agents",
  request: { query: publicMarketplaceQuerySchema },
  responses: {
    200: json(
      publicMarketplaceListSchema,
      "Verified public marketplace agents",
    ),
    400: json(errorResponseSchema, "Invalid marketplace filters"),
  },
});
const publicMarketplaceAgentRoute = createRoute({
  method: "get",
  path: "/v1/marketplace/agents/{id}",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: json(
      publicMarketplaceDetailSchema,
      "Verified agent intelligence profile",
    ),
    404: json(errorResponseSchema, "Agent is not publicly eligible"),
  },
});
const publicMarketplaceReviewsRoute = createRoute({
  method: "get",
  path: "/v1/marketplace/agents/{id}/reviews",
  request: { params: z.object({ id: z.uuid() }) },
  responses: {
    200: json(
      z.object({
        data: z.object({
          summary: z.object({
            total: z.number().int().nonnegative(),
            good: z.number().int().nonnegative(),
            bad: z.number().int().nonnegative(),
          }),
          reviews: z.array(marketplaceReviewSchema),
        }),
      }),
      "Verified marketplace reviews",
    ),
    404: json(errorResponseSchema, "Agent is not publicly eligible"),
  },
});
const marketplaceReviewEligibilityRoute = createRoute({
  method: "get",
  path: "/v1/marketplace/reviews/eligibility/{activationId}",
  request: {
    params: z.object({ activationId: z.uuid() }),
    query: z.object({ reviewerRole: z.enum(["BUYER", "AGENT"]) }),
    headers: z.object({ authorization: z.string().optional() }),
  },
  responses: {
    200: json(
      z.object({ data: z.record(z.string(), z.unknown()) }),
      "Review eligibility",
    ),
    409: json(errorResponseSchema, "Review is not eligible"),
  },
});
const createMarketplaceReviewRoute = createRoute({
  method: "post",
  path: "/v1/marketplace/reviews",
  request: {
    headers: z.object({ authorization: z.string().optional() }),
    body: {
      content: {
        "application/json": { schema: createMarketplaceReviewSchema },
      },
    },
  },
  responses: {
    201: json(
      z.object({ data: marketplaceReviewSchema }),
      "Verified review created",
    ),
    400: json(errorResponseSchema, "Invalid review"),
    409: json(errorResponseSchema, "Review is not eligible"),
  },
});
const publicMarketplaceCategoriesRoute = createRoute({
  method: "get",
  path: "/v1/marketplace/categories",
  responses: {
    200: json(
      publicCategoryCountsSchema,
      "Verified marketplace category counts",
    ),
  },
});
const publicMarketplaceCompareRoute = createRoute({
  method: "get",
  path: "/v1/marketplace/compare",
  request: {
    query: z.object({
      ids: z
        .string()
        .transform((value) => [...new Set(value.split(",").filter(Boolean))])
        .pipe(z.array(z.uuid()).min(1).max(4)),
    }),
  },
  responses: {
    200: json(
      z.object({ data: z.array(publicMarketplaceAgentSchema) }),
      "Verified agent comparison",
    ),
    400: json(errorResponseSchema, "Invalid comparison"),
  },
});
const internalMarketplaceStatusRoute = createRoute({
  method: "get",
  path: "/internal/marketplace-status",
  responses: {
    200: json(
      z.object({ data: z.record(z.string(), z.unknown()) }),
      "Internal corpus and public supply funnel",
    ),
  },
});
const principalHeaders = z.object({
  authorization: z.string().optional(),
  "x-relic-principal-id": z.uuid().optional(),
  "x-relic-mandate-timestamp": z.string().regex(/^\d+$/).optional(),
  "x-relic-mandate-signature": z
    .string()
    .regex(/^[0-9a-f]{64}$/)
    .optional(),
});
const mandateParams = z.object({ id: z.uuid() });
const mandateDataResponse = z.object({ data: z.any() });
const mandateResponses = {
  200: json(mandateDataResponse, "Mandate data"),
  400: json(errorResponseSchema, "Invalid mandate request"),
  404: json(errorResponseSchema, "Mandate or agent not found"),
  409: json(errorResponseSchema, "Mandate safety check failed"),
  503: json(errorResponseSchema, "Mandate service unavailable"),
};
const activationProfileRoute = createRoute({
  method: "get",
  path: "/v1/marketplace/agents/{id}/activation-profile",
  request: { params: mandateParams },
  responses: mandateResponses,
});
const createMandateRoute = createRoute({
  method: "post",
  path: "/v1/mandates",
  request: {
    headers: principalHeaders,
    body: {
      content: { "application/json": { schema: createMandateRequestSchema } },
    },
  },
  responses: {
    ...mandateResponses,
    201: json(mandateDataResponse, "Mandate draft created"),
  },
});
const getMandateRoute = createRoute({
  method: "get",
  path: "/v1/mandates/{id}",
  request: { params: mandateParams, headers: principalHeaders },
  responses: mandateResponses,
});
const myAgentsRoute = createRoute({
  method: "get",
  path: "/v1/my-agents",
  request: { headers: principalHeaders },
  responses: mandateResponses,
});
const editMandateRoute = createRoute({
  method: "patch",
  path: "/v1/mandates/{id}",
  request: {
    params: mandateParams,
    headers: principalHeaders,
    body: {
      content: { "application/json": { schema: createMandateRequestSchema } },
    },
  },
  responses: mandateResponses,
});
const mandateTransitionRoute = (action: string) =>
  createRoute({
    method: "post",
    path: `/v1/mandates/{id}/${action}`,
    request: {
      params: mandateParams,
      headers: principalHeaders,
      ...(action === "activate"
        ? {
            body: {
              content: {
                "application/json": {
                  schema: z.object({ explicitlyApproved: z.literal(true) }),
                },
              },
            },
          }
        : {}),
    },
    responses: mandateResponses,
  });
const reviewMandateRoute = mandateTransitionRoute("review");
const activateMandateRoute = mandateTransitionRoute("activate");
const pauseMandateRoute = mandateTransitionRoute("pause");
const resumeMandateRoute = mandateTransitionRoute("resume");
const revokeMandateRoute = mandateTransitionRoute("revoke");
const executionPreflightRoute = createRoute({
  method: "post",
  path: "/v1/mandates/{id}/execution-preflight",
  request: {
    params: mandateParams,
    headers: principalHeaders,
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              capability: z.string().min(1),
              asset: z.string().min(1).optional(),
              amount: z
                .string()
                .regex(/^\d+(?:\.\d+)?$/)
                .optional(),
              aggregateUsed: z
                .string()
                .regex(/^\d+(?:\.\d+)?$/)
                .optional(),
            })
            .strict(),
        },
      },
    },
  },
  responses: mandateResponses,
});
const executionParams = z.object({ id: z.uuid(), executionId: z.uuid() });
const createExecutionRoute = createRoute({
  method: "post",
  path: "/v1/mandates/{id}/executions",
  request: {
    params: mandateParams,
    headers: principalHeaders.extend({
      "idempotency-key": z.string().min(8).max(200),
    }),
    body: {
      content: { "application/json": { schema: executionActionRequestSchema } },
    },
  },
  responses: mandateResponses,
});
const listExecutionsRoute = createRoute({
  method: "get",
  path: "/v1/mandates/{id}/executions",
  request: { params: mandateParams, headers: principalHeaders },
  responses: mandateResponses,
});
const getExecutionRoute = createRoute({
  method: "get",
  path: "/v1/mandates/{id}/executions/{executionId}",
  request: { params: executionParams, headers: principalHeaders },
  responses: mandateResponses,
});
const approveExecutionRoute = createRoute({
  method: "post",
  path: "/v1/mandates/{id}/executions/{executionId}/approval",
  request: {
    params: executionParams,
    headers: principalHeaders,
    body: {
      content: {
        "application/json": {
          schema: z.object({
            normalizedHash: z.string().regex(/^[0-9a-f]{64}$/),
            approved: z.boolean(),
          }),
        },
      },
    },
  },
  responses: mandateResponses,
});

const walletChallengeRoute = createRoute({
  method: "post",
  path: "/v1/auth/wallet/challenge",
  request: {
    body: {
      content: { "application/json": { schema: walletChallengeRequestSchema } },
    },
  },
  responses: {
    201: json(z.object({ data: z.any() }), "Wallet challenge created"),
    400: json(errorResponseSchema, "Invalid wallet challenge request"),
    503: json(errorResponseSchema, "Wallet authentication unavailable"),
  },
});
const walletVerifyRoute = createRoute({
  method: "post",
  path: "/v1/auth/wallet/verify",
  request: {
    body: {
      content: {
        "application/json": { schema: walletChallengeVerificationSchema },
      },
    },
  },
  responses: {
    200: json(z.object({ data: z.any() }), "Wallet session established"),
    400: json(errorResponseSchema, "Invalid wallet signature"),
    409: json(errorResponseSchema, "Wallet challenge rejected"),
    503: json(errorResponseSchema, "Wallet authentication unavailable"),
  },
});
const privyVerifyRequestSchema = z.object({
  identityToken: z.string().min(1),
  address: z.string().regex(/^0x[a-fA-F0-9]{40}$/),
  chainId: z.literal(97),
});
const privyVerifyRoute = createRoute({
  method: "post",
  path: "/v1/auth/privy/verify",
  request: {
    body: {
      content: { "application/json": { schema: privyVerifyRequestSchema } },
    },
  },
  responses: {
    200: json(z.object({ data: z.any() }), "Privy session established"),
    401: json(errorResponseSchema, "Privy identity could not be verified"),
    503: json(errorResponseSchema, "Privy verification unavailable"),
  },
});
const walletSessionRoute = createRoute({
  method: "get",
  path: "/v1/auth/session",
  request: { headers: z.object({ authorization: z.string() }) },
  responses: {
    200: json(z.object({ data: z.any() }), "Current wallet session"),
    401: json(errorResponseSchema, "Wallet session invalid"),
  },
});
const walletLogoutRoute = createRoute({
  method: "post",
  path: "/v1/auth/logout",
  request: { headers: z.object({ authorization: z.string() }) },
  responses: {
    200: json(
      z.object({ data: z.object({ revoked: z.boolean() }) }),
      "Session revoked",
    ),
    401: json(errorResponseSchema, "Wallet session invalid"),
  },
});
const agentOffersRoute = createRoute({
  method: "get",
  path: "/v1/marketplace/agents/{id}/offers",
  request: { params: mandateParams },
  responses: {
    200: json(z.object({ data: z.array(z.any()) }), "Active verified offers"),
  },
});
const createOfferRoute = createRoute({
  method: "post",
  path: "/v1/operator/offers",
  request: {
    headers: z.object({ authorization: z.string() }),
    body: {
      content: { "application/json": { schema: createOfferRequestSchema } },
    },
  },
  responses: { 201: json(z.object({ data: z.any() }), "Offer draft created") },
});
const offerParams = z.object({ id: z.uuid() });
const listOperatorOffersRoute = createRoute({
  method: "get",
  path: "/v1/operator/offers",
  request: { headers: z.object({ authorization: z.string() }) },
  responses: {
    200: json(z.object({ data: z.array(z.any()) }), "Operator offers"),
  },
});
const operatorReadinessRoute = createRoute({
  method: "get",
  path: "/v1/operator/readiness",
  request: { headers: z.object({ authorization: z.string() }) },
  responses: {
    200: json(
      z.object({ data: z.array(z.record(z.string(), z.unknown())) }),
      "Owner-scoped marketplace readiness",
    ),
  },
});
const operatorAgentProfileRoute = createRoute({
  method: "put",
  path: "/v1/operator/agents/{id}/profile",
  request: {
    params: z.object({ id: z.uuid() }),
    headers: z.object({ authorization: z.string() }),
    body: {
      content: {
        "application/json": { schema: sellerMarketplaceProfileInputSchema },
      },
    },
  },
  responses: {
    200: json(z.object({ data: z.any() }), "Marketplace profile updated"),
    503: json(errorResponseSchema, "Marketplace profile storage unavailable"),
  },
});
const reviseOfferRoute = createRoute({
  method: "put",
  path: "/v1/operator/offers/{id}",
  request: {
    params: offerParams,
    headers: z.object({ authorization: z.string() }),
    body: {
      content: { "application/json": { schema: createOfferRequestSchema } },
    },
  },
  responses: {
    200: json(z.object({ data: z.any() }), "New immutable offer version"),
  },
});
const operatorAgreementsRoute = createRoute({
  method: "get",
  path: "/v1/operator/commerce-agreements",
  request: { headers: z.object({ authorization: z.string() }) },
  responses: {
    200: json(
      z.object({ data: z.array(z.any()) }),
      "Operator commerce history",
    ),
  },
});
const createCommerceValidationSessionRoute = createRoute({
  method: "post",
  path: "/v1/operator/offers/{id}/validation-sessions",
  request: {
    params: offerParams,
    headers: z.object({ authorization: z.string() }),
  },
  responses: {
    201: json(z.object({ data: z.any() }), "Validation handoff created"),
  },
});
const commerceValidationSessionRoute = createRoute({
  method: "get",
  path: "/v1/commerce-validation-sessions/{id}",
  request: {
    params: z.object({ id: z.uuid() }),
    query: z.object({ token: z.string().min(32) }),
  },
  responses: {
    200: json(z.object({ data: z.any() }), "Validation handoff"),
    404: json(errorResponseSchema, "Validation handoff unavailable"),
  },
});
const claimCommerceValidationSessionRoute = createRoute({
  method: "post",
  path: "/v1/commerce-validation-sessions/{id}/claim",
  request: {
    params: z.object({ id: z.uuid() }),
    headers: z.object({ authorization: z.string() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({ token: z.string().min(32) }),
        },
      },
    },
  },
  responses: {
    200: json(z.object({ data: z.any() }), "Validation handoff claimed"),
  },
});
const offerTransitionRoute = (action: "activate" | "pause" | "deactivate") =>
  createRoute({
    method: "post",
    path: `/v1/operator/offers/{id}/${action}`,
    request: {
      params: offerParams,
      headers: z.object({ authorization: z.string() }),
    },
    responses: { 200: json(z.object({ data: z.any() }), `Offer ${action}`) },
  });
const activateOfferRoute = offerTransitionRoute("activate");
const pauseOfferRoute = offerTransitionRoute("pause");
const deactivateOfferRoute = offerTransitionRoute("deactivate");
const hireOfferRoute = createRoute({
  method: "post",
  path: "/v1/offers/{id}/hire",
  request: {
    params: offerParams,
    headers: z.object({ authorization: z.string() }),
    body: {
      content: {
        "application/json": { schema: z.object({ mandateId: z.uuid() }) },
      },
    },
  },
  responses: {
    201: json(z.object({ data: z.any() }), "Agreement draft created"),
  },
});
const agreementParams = z.object({ id: z.uuid() });
const listAgreementsRoute = createRoute({
  method: "get",
  path: "/v1/commerce-agreements",
  request: { headers: z.object({ authorization: z.string() }) },
  responses: {
    200: json(z.object({ data: z.array(z.any()) }), "Principal agreements"),
  },
});
const getAgreementRoute = createRoute({
  method: "get",
  path: "/v1/commerce-agreements/{id}",
  request: {
    params: agreementParams,
    headers: z.object({ authorization: z.string() }),
  },
  responses: { 200: json(z.object({ data: z.any() }), "Commerce agreement") },
});
const prepareCommerceValidationRoute = createRoute({
  method: "post",
  path: "/v1/commerce-agreements/{id}/prepare-validation",
  request: {
    params: agreementParams,
    headers: z.object({ authorization: z.string() }),
  },
  responses: {
    200: json(
      z.object({ data: z.any() }),
      "Validation payment sequence prepared",
    ),
  },
});
const notifyFundedProviderRoute = createRoute({
  method: "post",
  path: "/v1/commerce-agreements/{id}/notify-funded",
  request: {
    params: agreementParams,
    headers: z.object({ authorization: z.string() }),
  },
  responses: {
    200: json(
      z.object({ data: z.any() }),
      "Provider notified about a finalized buyer-funded job",
    ),
  },
});
const preparedWalletTransactionRoute = createRoute({
  method: "get",
  path: "/v1/commerce-agreements/{id}/operations/{operationId}/wallet-transaction",
  request: {
    params: z.object({ id: z.uuid(), operationId: z.uuid() }),
    headers: z.object({ authorization: z.string() }),
  },
  responses: {
    200: json(
      z.object({ data: z.any() }),
      "Fresh wallet transaction preflight",
    ),
  },
});
const recordWalletTransactionRoute = createRoute({
  method: "post",
  path: "/v1/commerce-agreements/{id}/operations/{operationId}/wallet-transaction",
  request: {
    params: z.object({ id: z.uuid(), operationId: z.uuid() }),
    headers: z.object({ authorization: z.string() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
            signerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
            preparedPayloadHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
            nonce: z
              .string()
              .regex(/^(?:0x[0-9a-fA-F]+|\d+)$/)
              .optional(),
          }),
        },
      },
    },
  },
  responses: {
    200: json(z.object({ data: z.any() }), "Wallet transaction recorded"),
  },
});
const acceptAgreementTermsRoute = createRoute({
  method: "post",
  path: "/v1/commerce-agreements/{id}/accept-terms",
  request: {
    params: agreementParams,
    headers: z.object({ authorization: z.string() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            termsHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
          }),
        },
      },
    },
  },
  responses: { 200: json(z.object({ data: z.any() }), "Terms accepted") },
});
const authorizationChallengeRoute = createRoute({
  method: "post",
  path: "/v1/commerce-agreements/{id}/authorization-challenge",
  request: {
    params: agreementParams,
    headers: z.object({ authorization: z.string() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            actionHash: z
              .string()
              .regex(/^0x[0-9a-fA-F]{64}$/)
              .nullable()
              .default(null),
          }),
        },
      },
    },
  },
  responses: {
    201: json(z.object({ data: z.any() }), "Typed authorization challenge"),
  },
});
const verifyAuthorizationRoute = createRoute({
  method: "post",
  path: "/v1/commerce-agreements/{id}/authorization",
  request: {
    params: agreementParams,
    headers: z.object({ authorization: z.string() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            challengeId: z.uuid(),
            signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
          }),
        },
      },
    },
  },
  responses: {
    200: json(z.object({ data: z.any() }), "Authorization verified"),
  },
});
const cancelAgreementRoute = createRoute({
  method: "post",
  path: "/v1/commerce-agreements/{id}/cancel",
  request: {
    params: agreementParams,
    headers: z.object({ authorization: z.string() }),
  },
  responses: { 200: json(z.object({ data: z.any() }), "Agreement cancelled") },
});
const revokeAuthorizationRoute = createRoute({
  method: "post",
  path: "/v1/commerce-agreements/{id}/revoke-authorization",
  request: {
    params: agreementParams,
    headers: z.object({ authorization: z.string() }),
  },
  responses: {
    200: json(z.object({ data: z.any() }), "Authorization revoked"),
  },
});
const createCommerceActivationRoute = createRoute({
  method: "post",
  path: "/v1/commerce-agreements/{id}/activations",
  request: {
    params: agreementParams,
    headers: z.object({ authorization: z.string() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            executionRequestId: z.uuid(),
            authorizationId: z.uuid(),
          }),
        },
      },
    },
  },
  responses: {
    201: json(z.object({ data: z.any() }), "Prepared user-commerce activation"),
  },
});

const submissionSchema = z.object({
  id: z.uuid(),
  chainId: z.number().int(),
  registryAddress: z.string(),
  externalAgentId: z.string(),
  supplyType: z.enum(["third_party", "partner", "relic_reference"]),
  relicPrincipalId: z.string().nullable(),
  status: z.string(),
  submitterAddress: z.string().nullable(),
  ownershipVerifiedAt: z.iso.datetime().nullable(),
  agentId: z.uuid().nullable(),
  candidateId: z.uuid().nullable(),
  developerOverrides: z.record(z.string(), z.unknown()),
  createdAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});
const submissionParams = z.object({ id: z.uuid() });
const createSubmissionRoute = createRoute({
  method: "post",
  path: "/v1/agent-submissions",
  request: {
    headers: z.object({ authorization: z.string() }),
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              chainId: z.union([z.literal(56), z.literal(97)]),
              externalAgentId: z.string().regex(/^\d+$/),
              developerOverrides: z
                .object({
                  note: z.string().max(500).optional(),
                })
                .strict()
                .optional()
                .default({}),
            })
            .strict(),
        },
      },
    },
  },
  responses: {
    201: json(
      z.object({
        data: submissionSchema.extend({
          currentOwner: z.string(),
          name: z.string().nullable(),
        }),
      }),
      "Authenticated agent submission",
    ),
    400: json(errorResponseSchema, "Invalid request"),
    503: json(errorResponseSchema, "Onboarding unavailable"),
  },
});
const getSubmissionRoute = createRoute({
  method: "get",
  path: "/v1/agent-submissions/{id}",
  request: {
    params: submissionParams,
    headers: z.object({ authorization: z.string() }),
  },
  responses: {
    200: json(z.object({ data: submissionSchema }), "Agent submission"),
    404: json(errorResponseSchema, "Submission not found"),
    503: json(errorResponseSchema, "Onboarding unavailable"),
  },
});
const createOwnershipChallengeRoute = createRoute({
  method: "post",
  path: "/v1/agent-submissions/{id}/ownership-challenges",
  request: {
    params: submissionParams,
    headers: z.object({ authorization: z.string() }),
  },
  responses: {
    201: json(
      z.object({
        data: z.object({
          id: z.uuid(),
          message: z.string(),
          expectedOwner: z.string(),
          issuedAt: z.iso.datetime(),
          expiresAt: z.iso.datetime(),
        }),
      }),
      "Single-use ownership challenge",
    ),
    404: json(errorResponseSchema, "Submission not found"),
    409: json(errorResponseSchema, "Canonical identity not indexed"),
    503: json(errorResponseSchema, "Onboarding unavailable"),
  },
});
const verifyOwnershipRoute = createRoute({
  method: "post",
  path: "/v1/agent-submissions/{id}/ownership-verification",
  request: {
    params: submissionParams,
    headers: z.object({ authorization: z.string() }),
    body: {
      content: {
        "application/json": {
          schema: z.object({
            challengeId: z.uuid(),
            signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
          }),
        },
      },
    },
  },
  responses: {
    200: json(
      z.object({ data: z.object({ verified: z.literal(true) }) }),
      "Ownership verified",
    ),
    400: json(errorResponseSchema, "Invalid signature"),
    404: json(errorResponseSchema, "Challenge not found"),
    409: json(errorResponseSchema, "Owner changed or challenge expired"),
    503: json(errorResponseSchema, "Onboarding unavailable"),
  },
});

export function createApp(
  repository: AgentReadRepository,
  onboarding?: OnboardingRepository,
  mandateService?: MandateApplicationService,
  options: {
    mandateApiSecret?: string;
    executionService?: ExecutionApplicationService;
    walletAuthService?: WalletAuthenticationService;
    privyAppId?: string;
    privyJwtVerificationKey?: string;
    commerceService?: CommerceApplicationService;
    ownershipReader?: Erc8004OwnershipReader;
    sellerAuthorizationGuard?: SellerAuthorizationGuard;
    publicOrigin?: string;
    environmentName?: string;
    now?: () => Date;
  } = {},
) {
  const app = new OpenAPIHono({
    defaultHook: (result, context) => {
      if (!result.success) {
        return context.json(
          {
            error: {
              code: "validation_error",
              message: "Invalid request",
              details: result.error.issues.map(
                (issue) =>
                  `${issue.path.join(".") || "request"}: ${issue.message}`,
              ),
            },
          },
          400,
        );
      }
    },
  });

  app.onError((error, context) => {
    if (error instanceof MandateValidationError) {
      const status = error.code === "mandate_not_found" ? 404 : 409;
      return context.json(
        { error: { code: error.code, message: error.message } },
        status,
      );
    }
    console.error(error);
    return context.json(
      {
        error: {
          code: "internal_error",
          message: "An unexpected error occurred",
        },
      },
      500,
    );
  });
  app.notFound((context) =>
    context.json(
      { error: { code: "not_found", message: "Route not found" } },
      404,
    ),
  );

  app.openapi(healthRoute, (context) =>
    context.json({ status: "ok", service: "relic-api", version: "0.1.0" }, 200),
  );

  app.openapi(listAgentsRoute, async (context) => {
    const query = paginationQuerySchema.parse(context.req.query());
    const result = await repository.list({
      limit: query.limit,
      ...(query.cursor === undefined ? {} : { cursor: query.cursor }),
      ...(query.category === undefined ? {} : { category: query.category }),
      ...(query.capability === undefined
        ? {}
        : { capability: query.capability }),
      ...(query.interface === undefined ? {} : { interface: query.interface }),
      ...(query.readiness === undefined ? {} : { readiness: query.readiness }),
      ...(query.verificationStatus === undefined
        ? {}
        : { verificationStatus: query.verificationStatus }),
    });
    const response = agentListResponseSchema.parse({
      data: result.items,
      pagination: { nextCursor: result.nextCursor },
    });
    return context.json(response, 200);
  });

  app.openapi(getAgentRoute, async (context) => {
    const id = z.uuid().parse(context.req.param("id"));
    const agent = await repository.findById(id);
    if (agent === null) {
      return context.json(
        { error: { code: "agent_not_found", message: "Agent not found" } },
        404,
      );
    }
    return context.json(agentDetailResponseSchema.parse({ data: agent }), 200);
  });

  app.openapi(getAgentByChainRoute, async (context) => {
    const params = z
      .object({
        chainId: z.coerce.number().int().positive(),
        agentId: z.string().regex(/^\d+$/),
      })
      .parse(context.req.param());
    const agent =
      repository.findByChainIdentity === undefined
        ? null
        : await repository.findByChainIdentity(params.chainId, params.agentId);
    if (agent === null)
      return context.json(
        { error: { code: "agent_not_found", message: "Agent not found" } },
        404,
      );
    return context.json(agentDetailResponseSchema.parse({ data: agent }), 200);
  });

  app.openapi(categoriesRoute, async (context) => {
    const data =
      repository.listCategories === undefined
        ? initialCategoryResponse
        : await repository.listCategories();
    return context.json(categoryResponseSchema.parse({ data }), 200);
  });

  app.openapi(dataQualityRoute, async (context) => {
    const data =
      repository.dataQuality === undefined
        ? {}
        : await repository.dataQuality();
    return context.json({ data }, 200);
  });

  app.openapi(corpusStatusRoute, async (context) => {
    const { chainId } = z
      .object({
        chainId: z.coerce
          .number()
          .int()
          .refine((value) => value === 56 || value === 97)
          .default(56),
      })
      .parse(context.req.query());
    const data =
      repository.corpusStatus === undefined
        ? { chainId, readyForFullIngestion: false }
        : await repository.corpusStatus(chainId);
    return context.json({ data }, 200);
  });

  app.openapi(listAgentServicesRoute, async (context) => {
    const id = z.uuid().parse(context.req.param("id"));
    const agent = await repository.findById(id);
    if (agent === null)
      return context.json(
        { error: { code: "agent_not_found", message: "Agent not found" } },
        404,
      );
    const query = serviceFilterQuerySchema.parse(context.req.query());
    const filters = {
      ...(query.verificationLevel === undefined
        ? {}
        : { verificationLevel: query.verificationLevel }),
      ...(query.category === undefined ? {} : { category: query.category }),
      ...(query.interface === undefined ? {} : { interface: query.interface }),
      ...(query.actionable === undefined
        ? {}
        : { actionable: query.actionable }),
    };
    const data =
      repository.listAgentServices === undefined
        ? []
        : await repository.listAgentServices(id, filters);
    return context.json(serviceListResponseSchema.parse({ data }), 200);
  });

  app.openapi(getServiceRoute, async (context) => {
    const id = z.uuid().parse(context.req.param("id"));
    const service =
      repository.findService === undefined
        ? null
        : await repository.findService(id);
    if (service === null)
      return context.json(
        { error: { code: "service_not_found", message: "Service not found" } },
        404,
      );
    return context.json(
      serviceDetailResponseSchema.parse({ data: service }),
      200,
    );
  });

  app.openapi(publicMarketplaceRoute, async (context) => {
    const query = publicMarketplaceQuerySchema.parse(context.req.query());
    const result =
      repository.listPublicMarketplace === undefined
        ? {
            items: [],
            page: query.page,
            limit: query.limit,
            total: 0,
            totalPages: 0,
          }
        : await repository.listPublicMarketplace(query);
    return context.json(
      publicMarketplaceListSchema.parse({
        data: result.items,
        pagination: {
          page: result.page,
          limit: result.limit,
          total: result.total,
          totalPages: result.totalPages,
        },
      }),
      200,
    );
  });

  app.openapi(publicMarketplaceAgentRoute, async (context) => {
    const id = z.uuid().parse(context.req.param("id"));
    const agent =
      repository.findPublicMarketplaceAgent === undefined
        ? null
        : await repository.findPublicMarketplaceAgent(id);
    if (agent === null)
      return context.json(
        {
          error: {
            code: "marketplace_agent_not_found",
            message:
              "Agent is not currently eligible for the public marketplace",
          },
        },
        404,
      );
    return context.json(publicMarketplaceDetailSchema.parse(agent), 200);
  });

  app.openapi(publicMarketplaceReviewsRoute, async (context) => {
    const id = z.uuid().parse(context.req.param("id"));
    const agent =
      repository.findPublicMarketplaceAgent === undefined
        ? null
        : await repository.findPublicMarketplaceAgent(id);
    if (agent === null)
      return context.json(
        {
          error: {
            code: "marketplace_agent_not_found",
            message:
              "Agent is not currently eligible for the public marketplace",
          },
        },
        404,
      );
    return context.json(
      {
        data: {
          summary: {
            total: agent.reviewCount,
            good: agent.reviewGoodCount,
            bad: agent.reviewBadCount,
          },
          reviews: agent.reviews,
        },
      },
      200,
    );
  });

  app.openapi(publicMarketplaceCategoriesRoute, async (context) => {
    const data =
      repository.listPublicCategories === undefined
        ? []
        : await repository.listPublicCategories();
    return context.json(publicCategoryCountsSchema.parse({ data }), 200);
  });

  app.openapi(publicMarketplaceCompareRoute, async (context) => {
    const { ids } = publicMarketplaceCompareRoute.request.query.parse(
      context.req.query(),
    );
    const data =
      repository.comparePublicMarketplaceAgents === undefined
        ? []
        : await repository.comparePublicMarketplaceAgents(ids);
    return context.json(
      { data: z.array(publicMarketplaceAgentSchema).parse(data) },
      200,
    );
  });

  app.openapi(internalMarketplaceStatusRoute, async (context) => {
    const data =
      repository.internalMarketplaceStatus === undefined
        ? {}
        : await repository.internalMarketplaceStatus();
    return context.json({ data }, 200);
  });

  const requireMandates = () => {
    if (mandateService === undefined)
      throw new MandateValidationError(
        "mandates_unavailable",
        "Mandate activation is unavailable.",
      );
    return mandateService;
  };
  const requireExecutions = () => {
    if (options.executionService === undefined)
      throw new MandateValidationError(
        "executions_unavailable",
        "Execution control is unavailable.",
      );
    return options.executionService;
  };
  const walletPrincipal = async (context: {
    req: { header(name: string): string | undefined };
  }) => {
    const authorization = context.req.header("authorization");
    if (!authorization?.startsWith("Bearer "))
      throw new MandateValidationError(
        "wallet_session_required",
        "A production wallet session is required.",
      );
    if (options.walletAuthService === undefined)
      throw new MandateValidationError(
        "wallet_auth_unavailable",
        "Wallet authentication is unavailable.",
      );
    const session = await options.walletAuthService.session(
      authorization.slice("Bearer ".length),
    );
    if (session === null)
      throw new MandateValidationError(
        "wallet_session_invalid",
        "Wallet session is invalid or expired.",
      );
    return session;
  };
  const principal = async (context: {
    req: {
      header(name: string): string | undefined;
      method: string;
      path: string;
    };
  }) => {
    if (context.req.header("authorization")?.startsWith("Bearer "))
      return (await walletPrincipal(context)).principalId;
    const principalId = z
      .uuid()
      .parse(context.req.header("x-relic-principal-id"));
    const timestamp = z.coerce
      .number()
      .int()
      .parse(context.req.header("x-relic-mandate-timestamp"));
    const signature = z
      .string()
      .regex(/^[0-9a-f]{64}$/)
      .parse(context.req.header("x-relic-mandate-signature"));
    if (options.mandateApiSecret === undefined)
      throw new MandateValidationError(
        "mandate_auth_unavailable",
        "Mandate authorization is unavailable.",
      );
    if (Math.abs(Date.now() - timestamp) > 60_000)
      throw new MandateValidationError(
        "mandate_auth_expired",
        "Mandate authorization request expired.",
      );
    const expected = createHmac("sha256", options.mandateApiSecret)
      .update(
        `${timestamp}:${context.req.method.toUpperCase()}:${context.req.path}:${principalId}`,
      )
      .digest("hex");
    if (
      !timingSafeEqual(
        Buffer.from(signature, "hex"),
        Buffer.from(expected, "hex"),
      )
    )
      throw new MandateValidationError(
        "mandate_auth_invalid",
        "Mandate authorization signature is invalid.",
      );
    return principalId;
  };

  const requireWalletAuth = () => {
    if (options.walletAuthService === undefined)
      throw new MandateValidationError(
        "wallet_auth_unavailable",
        "Wallet authentication is unavailable.",
      );
    return options.walletAuthService;
  };
  const requireCommerce = () => {
    if (options.commerceService === undefined)
      throw new MandateValidationError(
        "commerce_unavailable",
        "Agent commerce is unavailable.",
      );
    return options.commerceService;
  };

  app.openapi(walletChallengeRoute, async (context) => {
    const body = walletChallengeRequestSchema.parse(await context.req.json());
    return context.json(
      { data: await requireWalletAuth().challenge(body.address, body.chainId) },
      201,
    );
  });

  app.openapi(walletVerifyRoute, async (context) => {
    const body = walletChallengeVerificationSchema.parse(
      await context.req.json(),
    );
    return context.json(
      {
        data: await requireWalletAuth().verify({
          challengeId: body.challengeId,
          address: body.address,
          chainId: body.chainId,
          signature: body.signature as `0x${string}`,
        }),
      },
      200,
    );
  });

  app.openapi(privyVerifyRoute, async (context) => {
    if (
      options.privyAppId === undefined ||
      options.privyJwtVerificationKey === undefined
    )
      return context.json(
        {
          error: {
            code: "privy_auth_unavailable",
            message: "Google sign-in is not configured for Relic yet.",
          },
        },
        503,
      );

    const body = privyVerifyRequestSchema.parse(await context.req.json());
    // Environment providers commonly store PEM values on one line using
    // literal `\n` escapes. Normalize that safe representation before handing
    // it to jose's SPKI importer.
    const verificationKey = options.privyJwtVerificationKey.replace(
      /\\n/g,
      "\n",
    );
    if (
      !verificationKey.includes("-----BEGIN PUBLIC KEY-----") ||
      !verificationKey.includes("-----END PUBLIC KEY-----")
    )
      return context.json(
        {
          error: {
            code: "privy_verification_key_invalid",
            message:
              "Relic's Privy verification key is incomplete. Add the full public-key PEM.",
          },
        },
        503,
      );
    try {
      const user = await verifyIdentityToken({
        identity_token: body.identityToken,
        app_id: options.privyAppId,
        verification_key: verificationKey,
      });
      const claimedAddress = getAddress(body.address);
      const ownsClaimedAddress = user.linked_accounts.some((account) => {
        if (
          typeof account !== "object" ||
          account === null ||
          !("address" in account) ||
          typeof account.address !== "string"
        )
          return false;
        try {
          return getAddress(account.address) === claimedAddress;
        } catch {
          return false;
        }
      });
      if (!ownsClaimedAddress)
        return context.json(
          {
            error: {
              code: "privy_wallet_mismatch",
              message:
                "The embedded wallet does not belong to this Google account.",
            },
          },
          401,
        );
      return context.json(
        {
          data: await requireWalletAuth().establishSession(
            claimedAddress,
            body.chainId,
          ),
        },
        200,
      );
    } catch (error) {
      console.warn("Privy identity verification failed", error);
      return context.json(
        {
          error: {
            code: "privy_identity_invalid",
            message: "Google sign-in could not be verified. Please try again.",
          },
        },
        401,
      );
    }
  });

  app.openapi(walletSessionRoute, async (context) =>
    context.json({ data: await walletPrincipal(context) }, 200),
  );

  app.openapi(marketplaceReviewEligibilityRoute, async (context) => {
    const { activationId } = z
      .object({ activationId: z.uuid() })
      .parse(context.req.param());
    const { reviewerRole } = z
      .object({ reviewerRole: z.enum(["BUYER", "AGENT"]) })
      .parse(context.req.query());
    return context.json(
      {
        data: await requireCommerce().marketplaceReviewEligibility(
          await walletPrincipal(context),
          activationId,
          reviewerRole,
        ),
      },
      200,
    );
  });

  app.openapi(createMarketplaceReviewRoute, async (context) => {
    const body = createMarketplaceReviewSchema.parse(await context.req.json());
    return context.json(
      {
        data: await requireCommerce().createMarketplaceReview(
          await walletPrincipal(context),
          body,
        ),
      },
      201,
    );
  });

  app.openapi(walletLogoutRoute, async (context) => {
    await walletPrincipal(context);
    const authorization = context.req.header("authorization")!;
    return context.json(
      {
        data: {
          revoked: await requireWalletAuth().revoke(
            authorization.slice("Bearer ".length),
          ),
        },
      },
      200,
    );
  });

  app.openapi(agentOffersRoute, async (context) => {
    const { id } = mandateParams.parse(context.req.param());
    return context.json({ data: await requireCommerce().offers(id) }, 200);
  });

  app.openapi(createOfferRoute, async (context) => {
    const session = await walletPrincipal(context);
    const body = createOfferRequestSchema.parse(await context.req.json());
    return context.json(
      { data: await requireCommerce().createOffer(session, body) },
      201,
    );
  });

  app.openapi(listOperatorOffersRoute, async (context) =>
    context.json(
      {
        data: await requireCommerce().operatorOffers(
          await walletPrincipal(context),
        ),
      },
      200,
    ),
  );

  app.openapi(operatorReadinessRoute, async (context) => {
    const session = await walletPrincipal(context);
    const authorizations =
      options.sellerAuthorizationGuard === undefined
        ? []
        : await options.sellerAuthorizationGuard.currentAuthorizations(
            session.principalId,
          );
    let ownerAddresses = [session.walletAddress];
    if (authorizations.length > 0) {
      ownerAddresses = [
        ...new Set(
          authorizations.map((authorization) => authorization.verifiedOwner),
        ),
      ];
    }
    const readiness =
      repository.sellerReadiness === undefined
        ? []
        : await Promise.all(
            ownerAddresses.map((owner) => repository.sellerReadiness!(owner)),
          );
    const catalogReadiness = [
      ...new Map(readiness.flat().map((item) => [item.agentId, item])).values(),
    ];
    const catalogExternalIds = new Set(
      catalogReadiness.map((item) => `${item.chainId}:${item.externalAgentId}`),
    );
    const pending =
      onboarding === undefined
        ? []
        : (
            await Promise.all(
              authorizations
                .filter((authorization) => authorization.agentId === null)
                .map(async (authorization) => ({
                  authorization,
                  submission: await onboarding.findSubmission(
                    authorization.submissionId,
                  ),
                })),
            )
          )
            .filter(
              ({ authorization, submission }) =>
                submission !== null &&
                submission.relicPrincipalId === session.principalId &&
                submission.status !== "REJECTED" &&
                !catalogExternalIds.has(
                  `${authorization.chainId}:${authorization.externalAgentId}`,
                ),
            )
            .map(({ authorization, submission }) =>
              pendingSellerReadiness(authorization, submission!),
            );
    const data = [...catalogReadiness, ...pending];
    return context.json({ data }, 200);
  });

  app.openapi(operatorAgentProfileRoute, async (context) => {
    const session = await walletPrincipal(context);
    const agentId = z.uuid().parse(context.req.param("id"));
    const profile = sellerMarketplaceProfileInputSchema.parse(
      await context.req.json(),
    );
    if (
      options.sellerAuthorizationGuard === undefined ||
      onboarding?.upsertSellerMarketplaceProfile === undefined
    )
      return context.json(
        {
          error: {
            code: "marketplace_profile_unavailable",
            message: "Marketplace profile storage is unavailable",
          },
        },
        503,
      );
    await options.sellerAuthorizationGuard.assertAuthorized(
      session.principalId,
      agentId,
    );
    const updated = await onboarding.upsertSellerMarketplaceProfile({
      agentId,
      principalId: session.principalId,
      description: profile.description,
      imageUrl: profile.imageUrl,
      updatedAt: options.now?.() ?? new Date(),
    });
    return context.json({ data: updated }, 200);
  });

  app.openapi(reviseOfferRoute, async (context) => {
    const { id } = offerParams.parse(context.req.param());
    const body = createOfferRequestSchema.parse(await context.req.json());
    return context.json(
      {
        data: await requireCommerce().reviseOffer(
          await walletPrincipal(context),
          id,
          body,
        ),
      },
      200,
    );
  });

  app.openapi(operatorAgreementsRoute, async (context) =>
    context.json(
      {
        data: await requireCommerce().operatorAgreements(
          await walletPrincipal(context),
        ),
      },
      200,
    ),
  );

  app.openapi(createCommerceValidationSessionRoute, async (context) => {
    const { id } = offerParams.parse(context.req.param());
    return context.json(
      {
        data: await requireCommerce().createCommerceValidationSession(
          await walletPrincipal(context),
          id,
        ),
      },
      201,
    );
  });

  app.openapi(commerceValidationSessionRoute, async (context) => {
    const { id } = z.object({ id: z.uuid() }).parse(context.req.param());
    const { token } = z
      .object({ token: z.string().min(32) })
      .parse(context.req.query());
    const data = await requireCommerce().commerceValidationSession(id, token);
    return data === null
      ? context.json(
          {
            error: {
              code: "validation_session_not_found",
              message: "Validation handoff is invalid or no longer available",
            },
          },
          404,
        )
      : context.json({ data }, 200);
  });

  app.openapi(claimCommerceValidationSessionRoute, async (context) => {
    const { id } = z.object({ id: z.uuid() }).parse(context.req.param());
    const { token } = z
      .object({ token: z.string().min(32) })
      .parse(await context.req.json());
    return context.json(
      {
        data: await requireCommerce().claimCommerceValidationSession(
          await walletPrincipal(context),
          id,
          token,
        ),
      },
      200,
    );
  });

  app.openapi(activateOfferRoute, async (context) => {
    const { id } = offerParams.parse(context.req.param());
    return context.json(
      {
        data: await requireCommerce().activateOffer(
          await walletPrincipal(context),
          id,
        ),
      },
      200,
    );
  });

  app.openapi(pauseOfferRoute, async (context) => {
    const { id } = offerParams.parse(context.req.param());
    return context.json(
      {
        data: await requireCommerce().transitionOffer(
          await walletPrincipal(context),
          id,
          "PAUSED",
        ),
      },
      200,
    );
  });

  app.openapi(deactivateOfferRoute, async (context) => {
    const { id } = offerParams.parse(context.req.param());
    return context.json(
      {
        data: await requireCommerce().transitionOffer(
          await walletPrincipal(context),
          id,
          "DEACTIVATED",
        ),
      },
      200,
    );
  });

  app.openapi(hireOfferRoute, async (context) => {
    const { id } = offerParams.parse(context.req.param());
    const body = z
      .object({ mandateId: z.uuid() })
      .parse(await context.req.json());
    return context.json(
      {
        data: await requireCommerce().hire(
          await walletPrincipal(context),
          id,
          body.mandateId,
        ),
      },
      201,
    );
  });

  app.openapi(listAgreementsRoute, async (context) =>
    context.json(
      {
        data: await requireCommerce().agreements(
          await walletPrincipal(context),
        ),
      },
      200,
    ),
  );

  app.openapi(getAgreementRoute, async (context) => {
    const { id } = agreementParams.parse(context.req.param());
    return context.json(
      {
        data: await requireCommerce().agreement(
          await walletPrincipal(context),
          id,
        ),
      },
      200,
    );
  });

  app.openapi(prepareCommerceValidationRoute, async (context) => {
    const { id } = agreementParams.parse(context.req.param());
    return context.json(
      {
        data: await requireCommerce().prepareCommerceValidation(
          await walletPrincipal(context),
          id,
        ),
      },
      200,
    );
  });

  app.openapi(notifyFundedProviderRoute, async (context) => {
    const { id } = agreementParams.parse(context.req.param());
    return context.json(
      {
        data: await requireCommerce().notifyFundedProvider(
          await walletPrincipal(context),
          id,
        ),
      },
      200,
    );
  });

  app.openapi(preparedWalletTransactionRoute, async (context) => {
    const params = z
      .object({ id: z.uuid(), operationId: z.uuid() })
      .parse(context.req.param());
    return context.json(
      {
        data: await requireCommerce().refreshPreparedWalletTransaction(
          await walletPrincipal(context),
          params.id,
          params.operationId,
        ),
      },
      200,
    );
  });

  app.openapi(recordWalletTransactionRoute, async (context) => {
    const params = z
      .object({ id: z.uuid(), operationId: z.uuid() })
      .parse(context.req.param());
    const body = z
      .object({
        transactionHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
        signerAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
        preparedPayloadHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
        nonce: z
          .string()
          .regex(/^(?:0x[0-9a-fA-F]+|\d+)$/)
          .optional(),
      })
      .parse(await context.req.json());
    return context.json(
      {
        data: await requireCommerce().recordWalletSubmission(
          await walletPrincipal(context),
          params.id,
          params.operationId,
          body.transactionHash,
          body.signerAddress,
          body.preparedPayloadHash,
          body.nonce === undefined ? undefined : BigInt(body.nonce),
        ),
      },
      200,
    );
  });

  app.openapi(acceptAgreementTermsRoute, async (context) => {
    const { id } = agreementParams.parse(context.req.param());
    const body = z
      .object({ termsHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/) })
      .parse(await context.req.json());
    return context.json(
      {
        data: await requireCommerce().acceptTerms(
          await walletPrincipal(context),
          id,
          body.termsHash,
        ),
      },
      200,
    );
  });

  app.openapi(authorizationChallengeRoute, async (context) => {
    const { id } = agreementParams.parse(context.req.param());
    const body = z
      .object({
        actionHash: z
          .string()
          .regex(/^0x[0-9a-fA-F]{64}$/)
          .nullable()
          .default(null),
      })
      .parse(await context.req.json());
    return context.json(
      {
        data: await requireCommerce().authorizationChallenge(
          await walletPrincipal(context),
          id,
          body.actionHash as `0x${string}` | null,
        ),
      },
      201,
    );
  });

  app.openapi(verifyAuthorizationRoute, async (context) => {
    const { id } = agreementParams.parse(context.req.param());
    const body = z
      .object({
        challengeId: z.uuid(),
        signature: z.string().regex(/^0x[0-9a-fA-F]+$/),
      })
      .parse(await context.req.json());
    const session = await walletPrincipal(context);
    return context.json(
      {
        data: await requireCommerce().verifyAuthorization(
          session,
          id,
          body.challengeId,
          body.signature as `0x${string}`,
        ),
      },
      200,
    );
  });

  app.openapi(cancelAgreementRoute, async (context) => {
    const { id } = agreementParams.parse(context.req.param());
    return context.json(
      {
        data: await requireCommerce().cancelAgreement(
          await walletPrincipal(context),
          id,
        ),
      },
      200,
    );
  });

  app.openapi(revokeAuthorizationRoute, async (context) => {
    const { id } = agreementParams.parse(context.req.param());
    return context.json(
      {
        data: await requireCommerce().revokeAuthorization(
          await walletPrincipal(context),
          id,
        ),
      },
      200,
    );
  });

  app.openapi(createCommerceActivationRoute, async (context) => {
    const { id } = agreementParams.parse(context.req.param());
    const body = z
      .object({ executionRequestId: z.uuid(), authorizationId: z.uuid() })
      .parse(await context.req.json());
    return context.json(
      {
        data: await requireCommerce().createActivation(
          await walletPrincipal(context),
          id,
          body.executionRequestId,
          body.authorizationId,
        ),
      },
      201,
    );
  });

  app.openapi(activationProfileRoute, async (context) => {
    const { id } = mandateParams.parse(context.req.param());
    return context.json(
      { data: await requireMandates().activationProfile(id) },
      200,
    );
  });

  app.openapi(createMandateRoute, async (context) => {
    const body = createMandateRequestSchema.parse(await context.req.json());
    const walletBacked =
      context.req.header("authorization")?.startsWith("Bearer ") === true;
    const wallet = walletBacked ? await walletPrincipal(context) : null;
    if (wallet !== null && wallet.chainId !== body.chainId)
      throw new MandateValidationError(
        "wallet_network_mismatch",
        "Wallet session network does not match the mandate network.",
      );
    const data = await requireMandates().create(
      wallet?.principalId ?? (await principal(context)),
      body,
      walletBacked ? "WALLET" : "DEVELOPMENT_SESSION",
    );
    return context.json({ data }, 201);
  });

  app.openapi(getMandateRoute, async (context) => {
    const { id } = mandateParams.parse(context.req.param());
    return context.json(
      { data: await requireMandates().get(await principal(context), id) },
      200,
    );
  });

  app.openapi(myAgentsRoute, async (context) =>
    context.json(
      { data: await requireMandates().list(await principal(context)) },
      200,
    ),
  );

  app.openapi(editMandateRoute, async (context) => {
    const { id } = mandateParams.parse(context.req.param());
    const body = createMandateRequestSchema.parse(await context.req.json());
    return context.json(
      {
        data: await requireMandates().edit(await principal(context), id, body),
      },
      200,
    );
  });

  app.openapi(reviewMandateRoute, async (context) => {
    const { id } = mandateParams.parse(context.req.param());
    return context.json(
      { data: await requireMandates().review(await principal(context), id) },
      200,
    );
  });

  app.openapi(activateMandateRoute, async (context) => {
    const { id } = mandateParams.parse(context.req.param());
    const body = z
      .object({ explicitlyApproved: z.literal(true) })
      .parse(await context.req.json());
    return context.json(
      {
        data: await requireMandates().activate(
          await principal(context),
          id,
          body.explicitlyApproved,
        ),
      },
      200,
    );
  });

  app.openapi(pauseMandateRoute, async (context) => {
    const { id } = mandateParams.parse(context.req.param());
    return context.json(
      { data: await requireMandates().pause(await principal(context), id) },
      200,
    );
  });

  app.openapi(resumeMandateRoute, async (context) => {
    const { id } = mandateParams.parse(context.req.param());
    return context.json(
      { data: await requireMandates().resume(await principal(context), id) },
      200,
    );
  });

  app.openapi(revokeMandateRoute, async (context) => {
    const { id } = mandateParams.parse(context.req.param());
    return context.json(
      { data: await requireMandates().revoke(await principal(context), id) },
      200,
    );
  });

  app.openapi(executionPreflightRoute, async (context) => {
    const { id } = mandateParams.parse(context.req.param());
    const body = executionPreflightRoute.request.body.content[
      "application/json"
    ].schema.parse(await context.req.json());
    return context.json(
      {
        data: await requireMandates().executionPreflight(
          await principal(context),
          id,
          {
            capability: body.capability,
            ...(body.asset === undefined ? {} : { asset: body.asset }),
            ...(body.amount === undefined ? {} : { amount: body.amount }),
            ...(body.aggregateUsed === undefined
              ? {}
              : { aggregateUsed: body.aggregateUsed }),
          },
        ),
      },
      200,
    );
  });

  app.openapi(createExecutionRoute, async (context) => {
    const { id } = mandateParams.parse(context.req.param());
    const idempotencyKey = z
      .string()
      .min(8)
      .max(200)
      .parse(context.req.header("idempotency-key"));
    const body = executionActionRequestSchema.parse(await context.req.json());
    return context.json(
      {
        data: await requireExecutions().request(
          await principal(context),
          id,
          idempotencyKey,
          body,
        ),
      },
      200,
    );
  });

  app.openapi(listExecutionsRoute, async (context) => {
    const { id } = mandateParams.parse(context.req.param());
    return context.json(
      { data: await requireExecutions().list(await principal(context), id) },
      200,
    );
  });

  app.openapi(getExecutionRoute, async (context) => {
    const { executionId } = executionParams.parse(context.req.param());
    return context.json(
      {
        data: await requireExecutions().get(
          await principal(context),
          executionId,
        ),
      },
      200,
    );
  });

  app.openapi(approveExecutionRoute, async (context) => {
    const { executionId } = executionParams.parse(context.req.param());
    const body = z
      .object({
        normalizedHash: z.string().regex(/^[0-9a-f]{64}$/),
        approved: z.boolean(),
      })
      .parse(await context.req.json());
    return context.json(
      {
        data: await requireExecutions().approve(
          await principal(context),
          executionId,
          body.normalizedHash,
          body.approved,
        ),
      },
      200,
    );
  });

  app.openapi(createSubmissionRoute, async (context) => {
    if (onboarding === undefined)
      return context.json(
        {
          error: {
            code: "onboarding_unavailable",
            message: "Onboarding is unavailable",
          },
        },
        503,
      );
    const session = await walletPrincipal(context);
    if (options.ownershipReader === undefined)
      throw new MandateValidationError(
        "ownership_rpc_unavailable",
        "Live ERC-8004 ownership lookup is unavailable.",
      );
    const body = createSubmissionRoute.request.body.content[
      "application/json"
    ].schema.parse(await context.req.json());
    const registryAddress = options.ownershipReader.registryAddress(
      body.chainId,
    );
    let currentOwner: `0x${string}`;
    try {
      currentOwner = await options.ownershipReader.ownerOf(
        body.chainId,
        body.externalAgentId,
      );
    } catch {
      throw new MandateValidationError(
        "agent_not_found",
        "Agent not found, or live ERC-8004 ownership could not be read.",
      );
    }
    let data;
    try {
      data = await onboarding.createSubmission({
        chainId: body.chainId,
        registryAddress,
        externalAgentId: body.externalAgentId,
        supplyType: "third_party",
        relicPrincipalId: session.principalId,
        liveOwner: currentOwner,
        submitterAddress: session.walletAddress,
        developerOverrides: body.developerOverrides,
        evidence: {
          source: "authenticated-operator-api",
          provenance: "developer_declared",
          relicPrincipalId: session.principalId,
          registryAddress,
          liveOwner: currentOwner,
          receivedAt: (options.now?.() ?? new Date()).toISOString(),
        },
      });
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("already bound to another Relic account")
      )
        throw new MandateValidationError(
          "seller_claim_conflict",
          error.message,
        );
      throw error;
    }
    const identity =
      repository.findByChainIdentity === undefined
        ? null
        : await repository.findByChainIdentity(
            body.chainId,
            body.externalAgentId,
          );
    return context.json(
      {
        data: {
          ...submissionSchema.parse(data),
          currentOwner,
          name: identity?.name ?? null,
        },
      },
      201,
    );
  });

  app.openapi(getSubmissionRoute, async (context) => {
    if (onboarding === undefined)
      return context.json(
        {
          error: {
            code: "onboarding_unavailable",
            message: "Onboarding is unavailable",
          },
        },
        503,
      );
    const { id } = submissionParams.parse(context.req.param());
    const session = await walletPrincipal(context);
    const data = await onboarding.findSubmission(id);
    if (data === null || data.relicPrincipalId !== session.principalId)
      return context.json(
        {
          error: {
            code: "submission_not_found",
            message: "Submission not found",
          },
        },
        404,
      );
    return context.json({ data: submissionSchema.parse(data) }, 200);
  });

  app.openapi(createOwnershipChallengeRoute, async (context) => {
    if (onboarding === undefined)
      return context.json(
        {
          error: {
            code: "onboarding_unavailable",
            message: "Onboarding is unavailable",
          },
        },
        503,
      );
    const { id } = submissionParams.parse(context.req.param());
    const session = await walletPrincipal(context);
    const submission = await onboarding.findSubmission(id);
    if (
      submission === null ||
      submission.relicPrincipalId !== session.principalId
    )
      return context.json(
        {
          error: {
            code: "submission_not_found",
            message: "Submission not found",
          },
        },
        404,
      );
    if (options.ownershipReader === undefined)
      throw new MandateValidationError(
        "ownership_rpc_unavailable",
        "Live ERC-8004 ownership lookup is unavailable.",
      );
    const registryAddress = options.ownershipReader.registryAddress(
      submission.chainId as 56 | 97,
    );
    if (getAddress(registryAddress) !== getAddress(submission.registryAddress))
      throw new MandateValidationError(
        "ownership_registry_mismatch",
        "The stored submission registry does not match Relic's configured registry.",
      );
    let currentOwner: `0x${string}`;
    try {
      currentOwner = await options.ownershipReader.ownerOf(
        submission.chainId as 56 | 97,
        submission.externalAgentId,
      );
    } catch {
      throw new MandateValidationError(
        "ownership_rpc_unavailable",
        "Current ERC-8004 ownership could not be confirmed.",
      );
    }
    const nonce = randomBytes(32).toString("hex");
    const issuedAt = options.now?.() ?? new Date();
    const expiresAt = new Date(issuedAt.getTime() + 5 * 60 * 1000);
    const message = buildOwnershipMessage({
      environment: options.environmentName ?? "development",
      origin: options.publicOrigin ?? "http://localhost:3000",
      principalId: session.principalId,
      chainId: submission.chainId,
      registryAddress,
      externalAgentId: submission.externalAgentId,
      expectedOwner: currentOwner,
      nonce,
      issuedAt: issuedAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
    });
    const challenge = await onboarding.createOwnershipChallenge({
      submissionId: submission.id,
      principalId: session.principalId,
      chainId: submission.chainId,
      registryAddress,
      externalAgentId: submission.externalAgentId,
      nonceHash: createHash("sha256").update(nonce).digest("hex"),
      message,
      expectedOwner: currentOwner,
      issuedAt,
      expiresAt,
    });
    return context.json(
      {
        data: {
          id: challenge.id,
          message: challenge.message,
          expectedOwner: challenge.expectedOwner,
          issuedAt: challenge.issuedAt,
          expiresAt: challenge.expiresAt,
        },
      },
      201,
    );
  });

  app.openapi(verifyOwnershipRoute, async (context) => {
    if (onboarding === undefined)
      return context.json(
        {
          error: {
            code: "onboarding_unavailable",
            message: "Onboarding is unavailable",
          },
        },
        503,
      );
    const { id } = submissionParams.parse(context.req.param());
    const session = await walletPrincipal(context);
    const body = verifyOwnershipRoute.request.body.content[
      "application/json"
    ].schema.parse(await context.req.json());
    const challenge = await onboarding.findOwnershipChallenge(body.challengeId);
    if (
      challenge === null ||
      challenge.submissionId !== id ||
      challenge.principalId !== session.principalId
    )
      return context.json(
        {
          error: {
            code: "challenge_not_found",
            message: "Challenge not found",
          },
        },
        404,
      );
    const submission = await onboarding.findSubmission(id);
    if (
      submission === null ||
      submission.relicPrincipalId !== session.principalId ||
      challenge.chainId !== submission.chainId ||
      challenge.externalAgentId !== submission.externalAgentId ||
      getAddress(challenge.registryAddress) !==
        getAddress(submission.registryAddress)
    )
      throw new MandateValidationError(
        "ownership_challenge_mismatch",
        "The ownership challenge is not bound to this agent and Relic account.",
      );
    if (new Date(challenge.expiresAt) <= (options.now?.() ?? new Date()))
      throw new MandateValidationError(
        "ownership_challenge_expired",
        "Ownership challenge expired. Generate a new challenge.",
      );
    if (options.ownershipReader === undefined)
      throw new MandateValidationError(
        "ownership_rpc_unavailable",
        "Live ERC-8004 ownership lookup is unavailable.",
      );
    let currentOwner: `0x${string}`;
    try {
      currentOwner = await options.ownershipReader.ownerOf(
        challenge.chainId as 56 | 97,
        challenge.externalAgentId,
      );
    } catch {
      throw new MandateValidationError(
        "ownership_rpc_unavailable",
        "Current ERC-8004 ownership could not be confirmed.",
      );
    }
    if (getAddress(currentOwner) !== getAddress(challenge.expectedOwner))
      return context.json(
        {
          error: {
            code: "ownership_mismatch",
            message:
              "Ownership changed. Generate a new verification challenge.",
          },
        },
        409,
      );
    const validSignature = await options.ownershipReader
      .verifyMessage({
        chainId: challenge.chainId as 56 | 97,
        owner: currentOwner,
        message: challenge.message,
        signature: body.signature as `0x${string}`,
      })
      .catch(() => false);
    if (!validSignature)
      return context.json(
        {
          error: {
            code: "invalid_signature",
            message: "Signature does not match the current ERC-8004 owner.",
          },
        },
        400,
      );
    const verifiedAt = options.now?.() ?? new Date();
    const authorization =
      await onboarding.consumeOwnershipChallengeAndAuthorize({
        challengeId: challenge.id,
        principalId: session.principalId,
        submissionId: submission.id,
        chainId: challenge.chainId,
        registryAddress: challenge.registryAddress,
        externalAgentId: challenge.externalAgentId,
        signerAddress: currentOwner,
        signatureDigest: keccak256(body.signature as `0x${string}`),
        verifiedAt,
      });
    if (authorization === null)
      return context.json(
        {
          error: {
            code: "challenge_expired",
            message: "Challenge is expired or already consumed",
          },
        },
        409,
      );
    return context.json({ data: { verified: true as const } }, 200);
  });

  app.doc("/openapi.json", {
    openapi: "3.1.0",
    info: { title: "Relic API", version: "0.1.0" },
  });
  return app;
}
