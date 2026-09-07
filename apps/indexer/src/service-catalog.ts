import type { DrizzleSupplyStore } from "@relic/database";

import { resolveA2aInvocationEndpoint } from "./a2a-service-discovery.js";
import {
  assertCandidateTransition,
  normalizeCuratedInterface,
  normalizedProtocolSupport,
} from "./launch-supply.js";

async function materializedEndpoint(
  interfaceProtocol: string,
  declaredEndpoint: string | null,
) {
  if (interfaceProtocol !== "a2a" || declaredEndpoint === null)
    return {
      endpoint: declaredEndpoint,
      verificationUrl: null,
      resolution: null,
    };
  const resolution = await resolveA2aInvocationEndpoint(declaredEndpoint);
  return resolution.status === "resolved"
    ? {
        endpoint: resolution.invocationUrl,
        verificationUrl: resolution.discoveryUrl,
        resolution,
      }
    : { endpoint: null, verificationUrl: resolution.discoveryUrl, resolution };
}

export async function materializeLaunchServices(
  store: DrizzleSupplyStore,
  options: { limit?: number } = {},
) {
  const counters = {
    candidates: 0,
    identitiesVerified: 0,
    services: 0,
    serviceIdentified: 0,
  };
  for (const row of await store.candidateSources(options.limit ?? 100)) {
    counters.candidates += 1;
    let status = row.candidate.status;
    if (status === "REVIEW_PENDING" && row.identityStatus === "verified") {
      assertCandidateTransition(status, "IDENTITY_VERIFIED");
      await store.transitionCandidate({
        candidateId: row.candidate.id,
        from: status,
        to: "IDENTITY_VERIFIED",
        evidence: {
          source: "direct-bsc-verification-queue",
          chainId: row.identity.chainId,
          registry: row.identity.registryAddress,
          tokenId: row.identity.externalAgentId,
        },
      });
      status = "IDENTITY_VERIFIED";
      counters.identitiesVerified += 1;
    }
    if (status !== "IDENTITY_VERIFIED" && status !== "SERVICE_IDENTIFIED")
      continue;
    const source = await store.sourceServices(row.agent.id);
    let materialized = 0;
    for (const service of source.canonical) {
      const interfaceProtocol = normalizeCuratedInterface(
        service.capability ?? service.name,
      );
      const endpoint = await materializedEndpoint(
        interfaceProtocol,
        service.endpoint,
      );
      await store.upsertMarketplaceService({
        agentId: row.agent.id,
        sourceServiceId: `canonical:${service.id}`,
        name: service.name,
        description: service.description,
        capability: service.capability,
        categorySlug: row.candidate.categorySlug,
        interfaceProtocol,
        endpoint: endpoint.endpoint,
        verificationUrl: endpoint.verificationUrl ?? service.verificationUrl,
        inputSchema: service.inputSchema,
        outputSchema: service.outputSchema,
        pricing: service.pricing,
        // An ERC-8004 identity chain is not proof of the service's execution chain.
        networkChainId: null,
        sla: service.sla,
        protocolSupport: normalizedProtocolSupport(interfaceProtocol),
        source: "direct-registration-file",
        provenance: "developer_declared",
        raw: { registration: service, a2aEndpointResolution: endpoint.resolution },
      });
      materialized += 1;
    }
    for (const declaration of source.declarations) {
      const interfaceProtocol = normalizeCuratedInterface(
        declaration.normalizedType,
      );
      const endpoint = await materializedEndpoint(
        interfaceProtocol,
        declaration.endpoint,
      );
      await store.upsertMarketplaceService({
        agentId: row.agent.id,
        sourceDeclarationId: declaration.id,
        sourceServiceId: `declaration:${declaration.id}`,
        name: declaration.rawName,
        categorySlug: row.candidate.categorySlug,
        interfaceProtocol,
        endpoint: endpoint.endpoint,
        verificationUrl: endpoint.verificationUrl,
        networkChainId: null,
        protocolSupport: normalizedProtocolSupport(interfaceProtocol),
        source: declaration.source,
        provenance: declaration.provenance,
        raw: {
          registration: declaration.raw,
          a2aEndpointResolution: endpoint.resolution,
        },
      });
      materialized += 1;
    }
    counters.services += materialized;
    if (materialized > 0 && status === "IDENTITY_VERIFIED") {
      assertCandidateTransition(status, "SERVICE_IDENTIFIED");
      await store.transitionCandidate({
        candidateId: row.candidate.id,
        from: status,
        to: "SERVICE_IDENTIFIED",
        evidence: {
          source: "relic-service-materialization",
          serviceCount: materialized,
        },
      });
      counters.serviceIdentified += 1;
    }
  }
  return counters;
}
