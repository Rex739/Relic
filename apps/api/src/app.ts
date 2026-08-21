import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import {
  createHash,
  createHmac,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

import {
  buildOwnershipMessage,
  createMandateRequestSchema,
  MandateValidationError,
  type AgentReadRepository,
  type OnboardingRepository,
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
  serviceDetailResponseSchema,
  serviceFilterQuerySchema,
  serviceListResponseSchema,
} from "@relic/validation";
import { z } from "zod";
import { getAddress, isAddress, keccak256, recoverMessageAddress } from "viem";

import type { MandateApplicationService } from "./mandates.js";

const json = (schema: z.ZodType, description: string) => ({
  content: { "application/json": { schema } },
  description,
});

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
  "x-relic-principal-id": z.uuid(),
  "x-relic-mandate-timestamp": z.string().regex(/^\d+$/),
  "x-relic-mandate-signature": z.string().regex(/^[0-9a-f]{64}$/),
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

const submissionSchema = z.object({
  id: z.uuid(),
  chainId: z.number().int(),
  externalAgentId: z.string(),
  supplyType: z.enum(["third_party", "partner", "relic_reference"]),
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
    body: {
      content: {
        "application/json": {
          schema: z
            .object({
              chainId: z.union([z.literal(56), z.literal(97)]),
              externalAgentId: z.string().regex(/^\d+$/),
              submitterAddress: z.string().refine(isAddress),
              developerOverrides: z
                .object({
                  categorySlug: z
                    .enum([
                      "health-factor-monitoring",
                      "grid-trading",
                      "rebalancing",
                      "yield-optimisation",
                    ])
                    .optional(),
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
    201: json(z.object({ data: submissionSchema }), "Agent submission"),
    400: json(errorResponseSchema, "Invalid request"),
    503: json(errorResponseSchema, "Onboarding unavailable"),
  },
});
const getSubmissionRoute = createRoute({
  method: "get",
  path: "/v1/agent-submissions/{id}",
  request: { params: submissionParams },
  responses: {
    200: json(z.object({ data: submissionSchema }), "Agent submission"),
    404: json(errorResponseSchema, "Submission not found"),
    503: json(errorResponseSchema, "Onboarding unavailable"),
  },
});
const createOwnershipChallengeRoute = createRoute({
  method: "post",
  path: "/v1/agent-submissions/{id}/ownership-challenges",
  request: { params: submissionParams },
  responses: {
    201: json(
      z.object({
        data: z.object({
          id: z.uuid(),
          message: z.string(),
          expectedOwner: z.string(),
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
  options: { mandateApiSecret?: string } = {},
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
  const principal = (context: {
    req: {
      header(name: string): string | undefined;
      method: string;
      path: string;
    };
  }) => {
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

  app.openapi(activationProfileRoute, async (context) => {
    const { id } = mandateParams.parse(context.req.param());
    return context.json(
      { data: await requireMandates().activationProfile(id) },
      200,
    );
  });

  app.openapi(createMandateRoute, async (context) => {
    const body = createMandateRequestSchema.parse(await context.req.json());
    const data = await requireMandates().create(principal(context), body);
    return context.json({ data }, 201);
  });

  app.openapi(getMandateRoute, async (context) => {
    const { id } = mandateParams.parse(context.req.param());
    return context.json(
      { data: await requireMandates().get(principal(context), id) },
      200,
    );
  });

  app.openapi(myAgentsRoute, async (context) =>
    context.json(
      { data: await requireMandates().list(principal(context)) },
      200,
    ),
  );

  app.openapi(editMandateRoute, async (context) => {
    const { id } = mandateParams.parse(context.req.param());
    const body = createMandateRequestSchema.parse(await context.req.json());
    return context.json(
      { data: await requireMandates().edit(principal(context), id, body) },
      200,
    );
  });

  app.openapi(reviewMandateRoute, async (context) => {
    const { id } = mandateParams.parse(context.req.param());
    return context.json(
      { data: await requireMandates().review(principal(context), id) },
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
          principal(context),
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
      { data: await requireMandates().pause(principal(context), id) },
      200,
    );
  });

  app.openapi(resumeMandateRoute, async (context) => {
    const { id } = mandateParams.parse(context.req.param());
    return context.json(
      { data: await requireMandates().resume(principal(context), id) },
      200,
    );
  });

  app.openapi(revokeMandateRoute, async (context) => {
    const { id } = mandateParams.parse(context.req.param());
    return context.json(
      { data: await requireMandates().revoke(principal(context), id) },
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
          principal(context),
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
    const body = createSubmissionRoute.request.body.content[
      "application/json"
    ].schema.parse(await context.req.json());
    const data = await onboarding.createSubmission({
      chainId: body.chainId,
      externalAgentId: body.externalAgentId,
      supplyType: "third_party",
      submitterAddress: getAddress(body.submitterAddress),
      developerOverrides: body.developerOverrides,
      evidence: {
        source: "public-api",
        provenance: "developer_declared",
        receivedAt: new Date().toISOString(),
      },
    });
    return context.json({ data: submissionSchema.parse(data) }, 201);
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
    const data = await onboarding.findSubmission(id);
    if (data === null)
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
    const submission = await onboarding.findSubmission(id);
    if (submission === null)
      return context.json(
        {
          error: {
            code: "submission_not_found",
            message: "Submission not found",
          },
        },
        404,
      );
    const identity = await onboarding.findOwnershipContext(
      submission.chainId,
      submission.externalAgentId,
    );
    if (identity === null)
      return context.json(
        {
          error: {
            code: "identity_not_indexed",
            message:
              "Canonical onchain identity must be indexed before ownership proof",
          },
        },
        409,
      );
    const nonce = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    const message = buildOwnershipMessage({
      submissionId: submission.id,
      chainId: submission.chainId,
      registryAddress: identity.registryAddress,
      externalAgentId: submission.externalAgentId,
      nonce,
      expiresAt: expiresAt.toISOString(),
    });
    const challenge = await onboarding.createOwnershipChallenge({
      submissionId: submission.id,
      nonceHash: createHash("sha256").update(nonce).digest("hex"),
      message,
      expectedOwner: identity.ownerAddress,
      expiresAt,
    });
    return context.json(
      {
        data: {
          id: challenge.id,
          message: challenge.message,
          expectedOwner: challenge.expectedOwner,
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
    const body = verifyOwnershipRoute.request.body.content[
      "application/json"
    ].schema.parse(await context.req.json());
    const challenge = await onboarding.findOwnershipChallenge(body.challengeId);
    if (challenge === null || challenge.submissionId !== id)
      return context.json(
        {
          error: {
            code: "challenge_not_found",
            message: "Challenge not found",
          },
        },
        404,
      );
    let signer: `0x${string}`;
    try {
      signer = await recoverMessageAddress({
        message: challenge.message,
        signature: body.signature as `0x${string}`,
      });
    } catch {
      return context.json(
        {
          error: { code: "invalid_signature", message: "Signature is invalid" },
        },
        400,
      );
    }
    const submission = await onboarding.findSubmission(id);
    const currentIdentity =
      submission === null
        ? null
        : await onboarding.findOwnershipContext(
            submission.chainId,
            submission.externalAgentId,
          );
    if (
      currentIdentity === null ||
      getAddress(currentIdentity.ownerAddress) !==
        getAddress(challenge.expectedOwner) ||
      getAddress(signer) !== getAddress(challenge.expectedOwner)
    )
      return context.json(
        {
          error: {
            code: "ownership_mismatch",
            message: "Current owner did not sign this challenge",
          },
        },
        409,
      );
    const consumed = await onboarding.consumeOwnershipChallenge({
      challengeId: challenge.id,
      signerAddress: signer,
      signatureDigest: keccak256(body.signature as `0x${string}`),
      verifiedAt: new Date(),
    });
    if (!consumed)
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
