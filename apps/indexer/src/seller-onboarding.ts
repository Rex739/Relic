import type { Erc8004RegistryProvider } from "@relic/blockchain";
import type {
  AgentSubmission,
  OnboardingRepository,
  RegistryAgentRecord,
} from "@relic/domain";
import {
  normalizeRegistryAgent,
  primaryMarketplaceCategory,
} from "@relic/domain";
import type { DrizzleAgentWriter, DrizzleSupplyStore } from "@relic/database";

import { materializeLaunchServices } from "./service-catalog.js";

type SellerOnboardingStore = Pick<
  OnboardingRepository,
  "findSubmission" | "listPendingCatalogSubmissions"
> & {
  transitionSubmission(input: {
    submissionId: string;
    from: AgentSubmission["status"];
    to: AgentSubmission["status"];
    evidence: Record<string, unknown>;
    agentId?: string;
    candidateId?: string;
  }): Promise<void>;
};

type SellerOnboardingDependencies = {
  readonly onboarding: SellerOnboardingStore;
  readonly supplyStore: Pick<
    DrizzleSupplyStore,
    | "createOnboardingCandidate"
    | "candidateSources"
    | "sourceServices"
    | "upsertMarketplaceService"
    | "transitionCandidate"
  >;
  readonly writer: Pick<DrizzleAgentWriter, "persist">;
  readonly providerFor: (
    submission: AgentSubmission,
  ) => Pick<Erc8004RegistryProvider, "getAgent">;
  readonly materialize?: typeof materializeLaunchServices;
};

export type SellerOnboardingResult =
  | { readonly state: "skipped" }
  | {
      readonly state: "catalogued";
      readonly agentId: string;
      readonly candidateId: string;
      readonly materialized: Awaited<
        ReturnType<typeof materializeLaunchServices>
      >;
    }
  | { readonly state: "blocked"; readonly reason: string };

async function blockSubmission(
  onboarding: SellerOnboardingDependencies["onboarding"],
  submission: AgentSubmission,
  from: AgentSubmission["status"],
  reason: string,
  evidence: Record<string, unknown>,
  agentId?: string,
) {
  await onboarding.transitionSubmission({
    submissionId: submission.id,
    from,
    to: "BLOCKED",
    evidence: { reason, ...evidence },
    ...(agentId === undefined ? {} : { agentId }),
  });
  return { state: "blocked" as const, reason };
}

/**
 * Catalogues an ownership-verified seller submission without asking the seller
 * to configure protocol fields. Service verification remains asynchronous in
 * the bounded inspector after materialization.
 */
export async function onboardVerifiedSellerSubmission(
  dependencies: SellerOnboardingDependencies,
  submissionId: string,
): Promise<SellerOnboardingResult> {
  const submission = await dependencies.onboarding.findSubmission(submissionId);
  const isInitialCatalog = submission?.status === "SUBMITTED";
  const isServiceRecovery =
    submission?.status === "SERVICE_VERIFICATION" &&
    submission.agentId !== null &&
    submission.candidateId !== null;
  if (
    submission === null ||
    submission.ownershipVerifiedAt === null ||
    (!isInitialCatalog && !isServiceRecovery)
  )
    return { state: "skipped" };

  // A previous catalog attempt can be interrupted after it creates the
  // candidate but before its registered services are durable. Retry that
  // narrow state once the queue detects it; sellers never need to repair it.
  if (isServiceRecovery) {
    const recoveryAgentId = submission.agentId;
    const recoveryCandidateId = submission.candidateId;
    if (recoveryAgentId === null || recoveryCandidateId === null)
      return { state: "skipped" };
    let record: RegistryAgentRecord | null;
    try {
      record = await dependencies
        .providerFor(submission)
        .getAgent(submission.externalAgentId);
    } catch (error) {
      return blockSubmission(
        dependencies.onboarding,
        submission,
        "SERVICE_VERIFICATION",
        "service_catalog_recovery_unavailable",
        { error: error instanceof Error ? error.message : String(error) },
        recoveryAgentId,
      );
    }
    if (record === null)
      return blockSubmission(
        dependencies.onboarding,
        submission,
        "SERVICE_VERIFICATION",
        "service_catalog_recovery_identity_not_found",
        {},
        recoveryAgentId,
      );

    const normalized = normalizeRegistryAgent(record);
    const internalId = await dependencies.writer.persist(normalized, record);
    if (normalized.services.length === 0)
      return blockSubmission(
        dependencies.onboarding,
        submission,
        "SERVICE_VERIFICATION",
        "agent_does_not_advertise_a_service",
        { metadataStatus: record.metadataResolution?.status },
        internalId,
      );
    const materialize = dependencies.materialize ?? materializeLaunchServices;
    const materialized = await materialize(
      dependencies.supplyStore as DrizzleSupplyStore,
      { limit: 25 },
    );
    return {
      state: "catalogued",
      agentId: internalId,
      candidateId: recoveryCandidateId,
      materialized,
    };
  }

  await dependencies.onboarding.transitionSubmission({
    submissionId: submission.id,
    from: "SUBMITTED",
    to: "IDENTITY_CHECK",
    evidence: {
      source: "relic-seller-onboarding-worker",
      chainId: submission.chainId,
      registryAddress: submission.registryAddress,
    },
  });

  let record: RegistryAgentRecord | null;
  try {
    record = await dependencies
      .providerFor(submission)
      .getAgent(submission.externalAgentId);
  } catch (error) {
    return blockSubmission(
      dependencies.onboarding,
      submission,
      "IDENTITY_CHECK",
      "onchain_identity_unavailable",
      { error: error instanceof Error ? error.message : String(error) },
    );
  }
  if (record === null)
    return blockSubmission(
      dependencies.onboarding,
      submission,
      "IDENTITY_CHECK",
      "onchain_identity_not_found",
      {
        chainId: submission.chainId,
        registryAddress: submission.registryAddress,
      },
    );

  const normalized = normalizeRegistryAgent(record);
  const internalId = await dependencies.writer.persist(normalized, record);
  await dependencies.onboarding.transitionSubmission({
    submissionId: submission.id,
    from: "IDENTITY_CHECK",
    to: "METADATA_CHECK",
    evidence: {
      canonicalAgentId: internalId,
      metadataStatus: record.metadataResolution?.status,
      provenance: "onchain_verified",
    },
    agentId: internalId,
  });
  if (record.metadataResolution?.status !== "resolved")
    return blockSubmission(
      dependencies.onboarding,
      submission,
      "METADATA_CHECK",
      "metadata_not_resolved",
      { metadataStatus: record.metadataResolution?.status },
      internalId,
    );

  const category = primaryMarketplaceCategory(normalized);
  if (category === null)
    return blockSubmission(
      dependencies.onboarding,
      submission,
      "METADATA_CHECK",
      "category_not_uniquely_classified",
      {
        derivedCategories: normalized.taxonomy
          .filter((term) => term.kind === "category")
          .map((term) => term.slug),
        classificationAuthority: "relic_verified_metadata",
      },
      internalId,
    );

  await dependencies.onboarding.transitionSubmission({
    submissionId: submission.id,
    from: "METADATA_CHECK",
    to: "SERVICE_DISCOVERY",
    evidence: { source: "canonical-registration-file" },
    agentId: internalId,
  });
  const candidateId = await dependencies.supplyStore.createOnboardingCandidate({
    agentId: internalId,
    categorySlug: category,
    supplyType: submission.supplyType,
    submissionId: submission.id,
  });
  const materialize = dependencies.materialize ?? materializeLaunchServices;
  const materialized = await materialize(
    dependencies.supplyStore as DrizzleSupplyStore,
    { limit: 25 },
  );
  await dependencies.onboarding.transitionSubmission({
    submissionId: submission.id,
    from: "SERVICE_DISCOVERY",
    to: "SERVICE_VERIFICATION",
    evidence: { candidateId, materialized },
    agentId: internalId,
    candidateId,
  });
  return {
    state: "catalogued",
    agentId: internalId,
    candidateId,
    materialized,
  };
}

export async function onboardPendingVerifiedSellerSubmissions(
  dependencies: SellerOnboardingDependencies,
  limit = 5,
) {
  const results: SellerOnboardingResult[] = [];
  for (const submission of await dependencies.onboarding.listPendingCatalogSubmissions(
    limit,
  ))
    results.push(
      await onboardVerifiedSellerSubmission(dependencies, submission.id),
    );
  return results;
}
