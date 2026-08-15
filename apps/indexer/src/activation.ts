import { createHash } from "node:crypto";

import { createBscPublicClient } from "@relic/blockchain";
import type { DrizzleSupplyStore } from "@relic/database";
import type { ActivationStatus } from "@relic/domain";

import {
  ERC8183_DEPLOYMENTS,
  ReadOnlyErc8183Provider,
} from "./erc8183-commerce.js";
import { verificationLevelRank } from "./launch-supply.js";

const activationTransitions: Record<
  ActivationStatus,
  readonly ActivationStatus[]
> = {
  PREPARED: ["TERMS_RESOLVED", "FAILED", "BLOCKED"],
  TERMS_RESOLVED: ["JOB_CREATED", "FAILED", "BLOCKED"],
  JOB_CREATED: ["FUNDED", "REJECTED", "EXPIRED", "FAILED", "BLOCKED"],
  FUNDED: ["SUBMITTED", "REJECTED", "EXPIRED", "FAILED", "BLOCKED"],
  SUBMITTED: ["COMPLETED", "REJECTED", "EXPIRED", "FAILED", "BLOCKED"],
  COMPLETED: [],
  REJECTED: [],
  EXPIRED: [],
  FAILED: [],
  BLOCKED: [],
};

export function assertActivationTransition(
  from: ActivationStatus,
  to: ActivationStatus,
) {
  if (!activationTransitions[from].includes(to))
    throw new Error(`Invalid activation transition: ${from} -> ${to}`);
}

export async function runSafeActivationAttempt(
  store: DrizzleSupplyStore,
  testnetRpcUrl: string,
) {
  const client = createBscPublicClient(97, testnetRpcUrl);
  const provider = new ReadOnlyErc8183Provider(client, 97);
  const deploymentInspection = await provider.inspectDeployment();
  const selected = (await store.activationCandidates(1))[0];
  if (selected === undefined) {
    const reason = "No real persisted ERC-8183 service candidate exists";
    const preflightId = await store.recordActivationPreflight({
      chainId: 97,
      status: "BLOCKED",
      commerceAddress: deploymentInspection.commerceAddress,
      paymentToken: deploymentInspection.paymentToken,
      contractDeployed: deploymentInspection.contractDeployed,
      transactionAttempted: false,
      evidence: {
        deploymentInspection,
        realPersistedServiceSelected: false,
        privateKeyRequested: false,
        fundsRequested: false,
      },
      failure: { reason },
    });
    return {
      persisted: false,
      preflightPersisted: true,
      preflightId,
      status: "BLOCKED" as const,
      reason,
      deploymentInspection,
      transactionAttempted: false,
    };
  }

  const service = selected.service;
  const deployment = ERC8183_DEPLOYMENTS[97];
  const description = `Relic bounded launch activation for persisted service ${service.id}`;
  const activationId = await store.createActivation({
    agentId: service.agentId,
    serviceId: service.id,
    chainId: 97,
    commerceAddress: deployment.commerce,
    providerAddress: null,
    budget: null,
    currencyToken: service.currencyToken,
    descriptionHash: createHash("sha256").update(description).digest("hex"),
    evidence: {
      boundary:
        "preparation only; no wallet, signature, approval, or transaction",
      realPersistedService: true,
      serviceVerificationLevel: service.verificationLevel,
      sourceIdentity: {
        chainId: selected.identity.chainId,
        registryAddress: selected.identity.registryAddress,
        agentId: selected.identity.externalAgentId,
      },
    },
  });
  let currentStatus: ActivationStatus = "PREPARED";

  try {
    const blockers = [
      service.endpoint === null ? "seller endpoint is absent" : null,
      verificationLevelRank(service.verificationLevel) <
      verificationLevelRank("PAYMENT_UNDERSTOOD")
        ? "seller payment terms are not independently understood"
        : null,
      "seller provider address is not independently resolved",
      "no user-authorized signer is configured",
    ].filter((value): value is string => value !== null);

    if (
      verificationLevelRank(service.verificationLevel) >=
      verificationLevelRank("PAYMENT_UNDERSTOOD")
    ) {
      assertActivationTransition("PREPARED", "TERMS_RESOLVED");
      await store.transitionActivation({
        activationId,
        status: "TERMS_RESOLVED",
        evidence: {
          serviceVerificationLevel: service.verificationLevel,
          deploymentInspection,
          note: "Protocol/deployment terms resolved; no invocation performed",
        },
      });
      currentStatus = "TERMS_RESOLVED";
      assertActivationTransition("TERMS_RESOLVED", "BLOCKED");
    } else {
      assertActivationTransition("PREPARED", "BLOCKED");
    }
    await store.transitionActivation({
      activationId,
      status: "BLOCKED",
      failure: { blockers },
      evidence: {
        deploymentInspection,
        transactionAttempted: false,
        privateKeyRequested: false,
        fundsRequested: false,
      },
    });
    return {
      persisted: true,
      activationId,
      serviceId: service.id,
      status: "BLOCKED" as const,
      blockers,
      deploymentInspection,
    };
  } catch (error) {
    assertActivationTransition(currentStatus, "FAILED");
    await store.transitionActivation({
      activationId,
      status: "FAILED",
      failure: {
        message: error instanceof Error ? error.message : String(error),
      },
      evidence: {
        transactionAttempted: false,
        phase: "read-only deployment inspection",
      },
    });
    throw error;
  }
}
