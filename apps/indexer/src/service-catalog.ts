import type { DrizzleSupplyStore } from "@relic/database";

import {
  assertCandidateTransition,
  normalizeCuratedInterface,
  normalizedProtocolSupport,
} from "./launch-supply.js";

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
      await store.upsertMarketplaceService({
        agentId: row.agent.id,
        sourceServiceId: `canonical:${service.id}`,
        name: service.name,
        description: service.description,
        capability: service.capability,
        categorySlug: row.candidate.categorySlug,
        interfaceProtocol,
        endpoint: service.endpoint,
        verificationUrl: service.verificationUrl,
        inputSchema: service.inputSchema,
        outputSchema: service.outputSchema,
        pricing: service.pricing,
        // An ERC-8004 identity chain is not proof of the service's execution chain.
        networkChainId: null,
        sla: service.sla,
        protocolSupport: normalizedProtocolSupport(interfaceProtocol),
        source: "direct-registration-file",
        provenance: "developer_declared",
        raw: service,
      });
      materialized += 1;
    }
    for (const declaration of source.declarations) {
      const interfaceProtocol = normalizeCuratedInterface(
        declaration.normalizedType,
      );
      await store.upsertMarketplaceService({
        agentId: row.agent.id,
        sourceDeclarationId: declaration.id,
        sourceServiceId: `declaration:${declaration.id}`,
        name: declaration.rawName,
        categorySlug: row.candidate.categorySlug,
        interfaceProtocol,
        endpoint: declaration.endpoint,
        networkChainId: null,
        protocolSupport: normalizedProtocolSupport(interfaceProtocol),
        source: declaration.source,
        provenance: declaration.provenance,
        raw: declaration.raw,
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
