import {
  agentDetailSchema,
  agentListItemSchema,
  marketplaceServiceSchema,
  marketplaceCategories,
} from "@relic/domain";
import { z } from "zod";

export const paginationQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  cursor: z.uuid().optional(),
  category: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
  capability: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
  interface: z
    .string()
    .regex(/^(?:[a-z0-9]+|other:[a-z0-9]+)(?:-[a-z0-9]+)*$/)
    .optional(),
  readiness: z
    .enum(["NOT_READY", "PARTIAL", "DISCOVERABLE", "ACTIONABLE"])
    .optional(),
  verificationStatus: z
    .enum(["unverified", "pending", "verified", "partial", "failed", "stale"])
    .optional(),
});

export const agentListResponseSchema = z.object({
  data: z.array(agentListItemSchema),
  pagination: z.object({ nextCursor: z.string().nullable() }),
});

export const agentDetailResponseSchema = z.object({ data: agentDetailSchema });

export const serviceFilterQuerySchema = z.object({
  verificationLevel: z
    .enum([
      "DECLARED",
      "ENDPOINT_OBSERVED",
      "SCHEMA_UNDERSTOOD",
      "PAYMENT_UNDERSTOOD",
      "INVOCATION_VERIFIED",
      "COMMERCE_VERIFIED",
    ])
    .optional(),
  category: z
    .string()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/)
    .optional(),
  interface: z
    .string()
    .regex(/^(?:[a-z0-9]+|other:[a-z0-9]+)(?:-[a-z0-9]+)*$/)
    .optional(),
  actionable: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

export const serviceListResponseSchema = z.object({
  data: z.array(marketplaceServiceSchema),
});

export const serviceDetailResponseSchema = z.object({
  data: marketplaceServiceSchema,
});

export const categoryResponseSchema = z.object({
  data: z.array(z.object({ slug: z.string(), label: z.string() })),
});

export const healthResponseSchema = z.object({
  status: z.literal("ok"),
  service: z.literal("relic-api"),
  version: z.string(),
});

export const errorResponseSchema = z.object({
  error: z.object({
    code: z.string(),
    message: z.string(),
    details: z.array(z.string()).optional(),
  }),
});

export const publicMarketplaceQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(48).default(12),
  text: z.string().trim().min(2).max(200).optional(),
  requirements: z
    .string()
    .transform((value) =>
      [...new Set(value.split(",").map((item) => item.trim()))].filter(Boolean),
    )
    .pipe(z.array(z.string().min(1).max(50)).min(1).max(5))
    .optional(),
  category: z
    .enum([
      "rebalancing",
      "grid-trading",
      "yield-optimisation",
      "health-factor-monitoring",
    ])
    .optional(),
  protocol: z.string().trim().min(1).max(50).optional(),
  tier: z.enum(["Working", "Actionable", "Proven"]).optional(),
  chainId: z
    .union([
      z.coerce.number().pipe(z.literal(56)),
      z.coerce.number().pipe(z.literal(97)),
    ])
    .optional(),
  interface: z.string().trim().min(1).max(50).optional(),
  pricingKnown: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
  hasReputation: z
    .enum(["true", "false"])
    .transform((value) => value === "true")
    .optional(),
});

export const publicMarketplaceAgentSchema = z.object({
  id: z.uuid(),
  name: z.string(),
  description: z.string(),
  category: z.string(),
  tier: z.enum(["Working", "Actionable", "Proven"]),
  availability: z.literal("available"),
  chainId: z.union([z.literal(56), z.literal(97)]),
  network: z.enum(["BNB Chain", "BNB Chain Testnet"]),
  registryAddress: z.string(),
  externalAgentId: z.string(),
  supplyType: z.enum(["third_party", "partner", "relic_reference"]),
  capabilities: z.array(z.string()),
  protocols: z.array(z.string()),
  interfaces: z.array(z.string()),
  pricingKnown: z.boolean(),
  activeOfferPrice: z
    .object({
      amountBaseUnits: z.string().regex(/^\d+$/),
      decimals: z.number().int().nonnegative(),
      symbol: z.string(),
      tokenAddress: z.string(),
    })
    .nullable(),
  hireable: z.boolean(),
  verifiedInvocationCount: z.number().int().nonnegative(),
  completedCommerceJobCount: z.number().int().nonnegative(),
  deliveryCompletedCount: z.number().int().nonnegative(),
  settlementCompletedCount: z.number().int().nonnegative(),
  unsuccessfulCommerceJobCount: z.number().int().nonnegative(),
  feedbackCount: z.number().int().nonnegative(),
  lastVerifiedAt: z.iso.datetime(),
  updatedAt: z.iso.datetime(),
});

export const publicMarketplaceListSchema = z.object({
  data: z.array(publicMarketplaceAgentSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
    totalPages: z.number().int().nonnegative(),
  }),
});

export const publicMarketplaceDetailSchema =
  publicMarketplaceAgentSchema.extend({
    ownerAddress: z.string(),
    metadataUri: z.string(),
    registrationTransaction: z.string().nullable(),
    registrationBlock: z.string().nullable(),
    services: z.array(
      z.object({
        id: z.uuid(),
        name: z.string(),
        description: z.string().nullable(),
        interface: z.string(),
        endpoint: z.string(),
        availability: z.literal("available"),
        verificationLevel: z.enum(["INVOCATION_VERIFIED", "COMMERCE_VERIFIED"]),
        pricing: z.unknown(),
        protocolSupport: z.record(z.string(), z.unknown()),
        lastVerifiedAt: z.iso.datetime(),
        provenance: z.string(),
      }),
    ),
    evidence: z.array(
      z.object({
        fieldPath: z.string(),
        label: z.string(),
        provenance: z.string(),
        source: z.string(),
        sourceUri: z.string().nullable(),
        observedAt: z.iso.datetime(),
      }),
    ),
    outcomes: z.array(
      z.object({
        invocationSuccessful: z.boolean(),
        commerceSuccessful: z.boolean(),
        executionDurationMs: z.number().nullable(),
        responseStatus: z.string().nullable(),
        deliveredAt: z.iso.datetime().nullable(),
        settlementState: z.string(),
        observedCost: z.string(),
        observedAt: z.iso.datetime(),
      }),
    ),
    surfacedBecause: z.array(z.string()),
    checks: z.object({
      identityVerified: z.boolean(),
      endpointReachable: z.boolean(),
      protocolVerified: z.boolean(),
      invocationVerified: z.boolean(),
      commerceVerified: z.boolean(),
      lastCheckedAt: z.iso.datetime(),
    }),
  });

export const publicCategoryCountsSchema = z.object({
  data: z.array(
    z.object({
      slug: z.string(),
      label: z.string(),
      working: z.number().int().nonnegative(),
      actionable: z.number().int().nonnegative(),
      protocols: z.array(z.string()),
    }),
  ),
});

export const initialCategoryResponse = marketplaceCategories.map((slug) => ({
  slug,
  label: slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" "),
}));
