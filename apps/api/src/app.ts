import { createRoute, OpenAPIHono } from "@hono/zod-openapi";
import { createHash, randomBytes } from "node:crypto";

import {
  buildOwnershipMessage,
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
  serviceDetailResponseSchema,
  serviceFilterQuerySchema,
  serviceListResponseSchema,
} from "@relic/validation";
import { z } from "zod";
import { getAddress, isAddress, keccak256, recoverMessageAddress } from "viem";

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
