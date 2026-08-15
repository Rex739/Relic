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

export const initialCategoryResponse = marketplaceCategories.map((slug) => ({
  slug,
  label: slug
    .split("-")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" "),
}));
