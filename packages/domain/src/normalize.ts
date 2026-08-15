import { randomUUID } from "node:crypto";

import {
  canonicalAgentSchema,
  type CanonicalAgent,
  type Evidence,
} from "./model.js";
import {
  registryAgentRecordSchema,
  registryMetadataSchema,
  type RegistryAgentRecord,
  UpstreamAgentValidationError,
} from "./provider.js";

function validationIssues(error: {
  issues: readonly { path: PropertyKey[]; message: string }[];
}): string[] {
  return error.issues.map(
    (issue) => `${issue.path.join(".") || "root"}: ${issue.message}`,
  );
}

export function normalizeRegistryAgent(
  input: RegistryAgentRecord,
  options: { id?: string; now?: string } = {},
): CanonicalAgent {
  const recordResult = registryAgentRecordSchema.safeParse(input);
  if (!recordResult.success) {
    throw new UpstreamAgentValidationError(
      "The registry provider returned an invalid agent record",
      validationIssues(recordResult.error),
    );
  }

  const record = recordResult.data;
  const metadataResult = registryMetadataSchema.safeParse(record.metadata);
  const metadata = metadataResult.success
    ? metadataResult.data
    : registryMetadataSchema.parse({ services: [] });
  const now = options.now ?? new Date().toISOString();
  const onchainEvidence: Evidence = {
    provenance: "onchain_verified",
    source: record.source,
    sourceUri: `eip155:${record.chainId}:${record.registryAddress}/${record.agentId}`,
    observedAt: record.fetchedAt,
    chainId: record.chainId,
    ...(record.registrationTransaction === null
      ? {}
      : { transactionHash: record.registrationTransaction }),
    ...(record.registrationBlock === null
      ? {}
      : { blockNumber: record.registrationBlock }),
  };
  const declaredEvidence: Evidence = {
    provenance: "developer_declared",
    source: "erc-8004-registration-file",
    sourceUri: record.metadataUri,
    observedAt: record.fetchedAt,
  };
  const sourced = (value: string) => ({ value, evidence: [declaredEvidence] });
  const optionalSourced = (value: string | undefined) =>
    value === undefined ? null : sourced(value);
  const classificationText = metadata.services.flatMap((service) => [
    ...(service.skills ?? []),
    ...(service.domains ?? []),
  ]);
  const categoryRules = [
    ["rebalancing", "Rebalancing", /(^|[/_. -])rebalanc(e|ing)($|[/_. -])/i],
    [
      "grid-trading",
      "Grid Trading",
      /(^|[/_. -])grid[_. -]?trad(e|ing)($|[/_. -])/i,
    ],
    [
      "yield-optimisation",
      "Yield Optimisation",
      /(^|[/_. -])yield[_. -]?optimi[sz](e|ation)($|[/_. -])/i,
    ],
    [
      "health-factor-monitoring",
      "Health Factor Monitoring",
      /(^|[/_. -])health[_. -]?factor[_. -]?(monitor|monitoring)($|[/_. -])/i,
    ],
  ] as const;
  const taxonomy = categoryRules
    .filter(([, , expression]) =>
      classificationText.some((value) => expression.test(value)),
    )
    .map(([slug, label]) => ({
      kind: "category" as const,
      slug,
      label,
      evidence: [
        {
          ...declaredEvidence,
          details: { method: "explicit_metadata_capability_match" },
        },
      ],
    }));

  return canonicalAgentSchema.parse({
    id: options.id ?? randomUUID(),
    identity: {
      standard: "erc-8004",
      namespace: "eip155",
      chainId: record.chainId,
      registryAddress: record.registryAddress,
      agentId: record.agentId,
      ownerAddress: record.ownerAddress,
      registrationStatus:
        metadata.active === false ? "deregistered" : "registered",
      registrationTransaction: record.registrationTransaction,
      registrationBlock: record.registrationBlock,
      registeredAt: record.registeredAt,
      fieldEvidence: {
        chainId: [onchainEvidence],
        registryAddress: [onchainEvidence],
        agentId: [onchainEvidence],
        ownerAddress: [onchainEvidence],
        registrationStatus: [onchainEvidence],
      },
    },
    profile: {
      name: metadata.name === undefined ? null : sourced(metadata.name),
      description: optionalSourced(metadata.description),
      imageUrl: optionalSourced(metadata.image),
      websiteUrl: optionalSourced(metadata.website),
      metadataUri: { value: record.metadataUri, evidence: [onchainEvidence] },
      developerIdentity: null,
    },
    taxonomy,
    services: metadata.services.map((service) => ({
      externalId: service.id ?? null,
      name: service.name,
      capability: null,
      description: service.description ?? null,
      inputSchema: null,
      outputSchema: null,
      pricing: null,
      endpoint: service.endpoint ?? null,
      sla:
        service.version === undefined
          ? null
          : { protocolVersion: service.version },
      availabilityStatus: "unknown",
      evidence: [declaredEvidence],
    })),
    metrics: [],
    reputation: [],
    availability: [],
    createdAt: record.registeredAt ?? now,
    updatedAt: now,
  });
}
