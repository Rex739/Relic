import { buildJobDescription } from "@bnbagent/sdk/erc8183";
import {
  createDatabase,
  DrizzleOnboardingStore,
  DrizzleSupplyStore,
} from "@relic/database";
import { keccak256, stringToHex } from "viem";

import { SdkErc8183CommerceProvider } from "./sdk-commerce.js";

type ReferenceCandidate = Awaited<
  ReturnType<DrizzleSupplyStore["referenceCommerceCandidates"]>
>[number];

const arg = (name: string) =>
  process.argv
    .find((value) => value.startsWith(`--${name}=`))
    ?.slice(name.length + 3);
const required = (name: string) => {
  const value = arg(name);
  if (!value) throw new Error(`--${name}=... is required`);
  return value;
};
const log = (value: Record<string, unknown>) =>
  console.info(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  );
const jsonSafe = (value: unknown) =>
  JSON.parse(
    JSON.stringify(value, (_key, item: unknown) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  ) as unknown;
const sleep = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required");
const password = process.env.WALLET_PASSWORD;
if (!password)
  throw new Error(
    "WALLET_PASSWORD is required. Stop here and have the human operator enter it locally.",
  );
const walletPassword = password;

const connection = createDatabase(databaseUrl, { max: 2 });
const supply = new DrizzleSupplyStore(connection.db);
const onboarding = new DrizzleOnboardingStore(connection.db);

async function providerFor(input: {
  providerAddress: `0x${string}`;
  sellerUrl: string;
}) {
  const walletAddress = arg("wallet-address");
  return SdkErc8183CommerceProvider.fromEncryptedKeystore({
    password: walletPassword,
    walletsDir: required("wallets-dir"),
    ...(walletAddress === undefined ? {} : { walletAddress }),
    providerAddress: input.providerAddress,
    sellerUrl: input.sellerUrl,
  });
}

async function recordVerifiedInvocation(
  selected: ReferenceCandidate,
  evidence: Record<string, unknown>,
) {
  if (selected.service.verificationLevel === "PAYMENT_UNDERSTOOD")
    await supply.recordServiceVerification({
      serviceId: selected.service.id,
      fromLevel: "PAYMENT_UNDERSTOOD",
      toLevel: "INVOCATION_VERIFIED",
      result: "passed",
      protocol: "erc8183",
      requestMethod: "POST",
      httpStatus: 200,
      availability: "available",
      evidence,
    });
  if (selected.candidate.status === "SERVICE_OBSERVED")
    await supply.transitionCandidate({
      candidateId: selected.candidate.id,
      from: "SERVICE_OBSERVED",
      to: "INVOCATION_VERIFIED",
      evidence,
    });
  const submission = await onboarding.findSubmissionByCandidateId(
    selected.candidate.id,
  );
  if (submission?.status === "SERVICE_VERIFICATION")
    await onboarding.transitionSubmission({
      submissionId: submission.id,
      from: "SERVICE_VERIFICATION",
      to: "COMMERCE_PREFLIGHT",
      evidence,
      agentId: selected.service.agentId,
      candidateId: selected.candidate.id,
    });
}

async function recordVerifiedCommerce(
  serviceId: string,
  evidence: Record<string, unknown>,
) {
  const selected = (await supply.referenceCommerceCandidates(100)).find(
    ({ service }) => service.id === serviceId,
  );
  if (!selected) throw new Error("Reference commerce candidate disappeared");
  if (selected.service.verificationLevel === "INVOCATION_VERIFIED")
    await supply.recordServiceVerification({
      serviceId,
      fromLevel: "INVOCATION_VERIFIED",
      toLevel: "COMMERCE_VERIFIED",
      result: "passed",
      protocol: "erc8183",
      requestMethod: null,
      httpStatus: null,
      availability: "available",
      evidence,
    });
  if (selected.candidate.status === "INVOCATION_VERIFIED")
    await supply.transitionCandidate({
      candidateId: selected.candidate.id,
      from: "INVOCATION_VERIFIED",
      to: "ACTIONABLE",
      evidence,
    });
  const submission = await onboarding.findSubmissionByCandidateId(
    selected.candidate.id,
  );
  if (submission?.status === "COMMERCE_PREFLIGHT")
    await onboarding.transitionSubmission({
      submissionId: submission.id,
      from: "COMMERCE_PREFLIGHT",
      to: "ACTIONABLE",
      evidence,
      agentId: selected.service.agentId,
      candidateId: selected.candidate.id,
    });
}

async function settleOrCheckpoint(
  activation: NonNullable<
    Awaited<ReturnType<DrizzleSupplyStore["findActivation"]>>
  >,
) {
  if (!activation.activation.externalJobId)
    throw new Error("Activation has no persisted ERC-8183 job ID");
  if (!activation.service.endpoint || !activation.activation.providerAddress)
    throw new Error("Activation has no seller endpoint/provider evidence");
  const commerce = await providerFor({
    providerAddress: activation.activation.providerAddress as `0x${string}`,
    sellerUrl: activation.service.endpoint,
  });
  const routing = commerce.routingAddresses();
  const clientAddress = arg("wallet-address");
  const jobId = BigInt(activation.activation.externalJobId);
  let job = await commerce.refreshJob(jobId);
  if (activation.activation.status === "JOB_CREATED" && job.state === "OPEN") {
    await commerce.registerJob(jobId);
    await commerce.setBudget(jobId, 0n);
    await commerce.fundJob(jobId, 0n);
    const fundingEvidence = commerce.drainEvidence();
    const fundWrite = fundingEvidence.at(-1);
    if (!fundWrite) throw new Error("Resumed fund(0) write evidence missing");
    const fundBlock =
      fundWrite.blockNumber === undefined
        ? undefined
        : BigInt(fundWrite.blockNumber);
    await supply.transitionActivation({
      activationId: activation.activation.id,
      status: "FUNDED",
      externalJobId: jobId.toString(),
      transactionHash: fundWrite.transactionHash,
      ...(fundBlock === undefined ? {} : { blockNumber: fundBlock }),
      evidence: {
        writes: fundingEvidence,
        tokenTransferAmount: "0",
        resumedFromCheckpoint: true,
      },
    });
    if (activation.activation.lifecycleState === "ONCHAIN_CREATED")
      await onboarding.transitionActivationLifecycle({
        activationId: activation.activation.id,
        from: "ONCHAIN_CREATED",
        to: "ACTIVE",
        transactionHash: fundWrite.transactionHash,
        ...(fundBlock === undefined ? {} : { blockNumber: fundBlock }),
        evidence: {
          writes: fundingEvidence,
          budget: "0",
          resumedFromCheckpoint: true,
        },
      });
    for (let attempt = 0; attempt < 12; attempt += 1) {
      job = await commerce.refreshJob(jobId);
      if (job.state === "SUBMITTED" || job.state === "COMPLETED") break;
      await sleep(5_000);
    }
  }
  if (job.state !== "SUBMITTED" && job.state !== "COMPLETED") {
    log({
      event: "activation_checkpoint",
      activationId: activation.activation.id,
      job,
    });
    return;
  }
  if (job.state === "SUBMITTED") {
    const submissionEvidence = await commerce.submissionEvidence(jobId);
    if (activation.activation.status === "FUNDED")
      await supply.transitionActivation({
        activationId: activation.activation.id,
        status: "SUBMITTED",
        externalJobId: jobId.toString(),
        resultReference: job.deliverable,
        evidence: {
          source: "onchain-job-submitted-event",
          submittedAt: job.submittedAt.toString(),
          submissionEvent: jsonSafe(submissionEvidence),
        },
        ...(submissionEvidence?.transactionHash === null ||
        submissionEvidence?.transactionHash === undefined
          ? {}
          : { transactionHash: submissionEvidence.transactionHash }),
        ...(submissionEvidence?.blockNumber === null ||
        submissionEvidence?.blockNumber === undefined
          ? {}
          : { blockNumber: submissionEvidence.blockNumber }),
      });
    if (activation.activation.lifecycleState === "ACTIVE")
      await onboarding.transitionActivationLifecycle({
        activationId: activation.activation.id,
        from: "ACTIVE",
        to: "DELIVERED",
        evidence: {
          source: "onchain-read",
          deliverable: job.deliverable,
          submittedAt: job.submittedAt.toString(),
          submissionEvent: jsonSafe(submissionEvidence),
        },
        ...(submissionEvidence?.transactionHash === null ||
        submissionEvidence?.transactionHash === undefined
          ? {}
          : { transactionHash: submissionEvidence.transactionHash }),
        ...(submissionEvidence?.blockNumber === null ||
        submissionEvidence?.blockNumber === undefined
          ? {}
          : { blockNumber: submissionEvidence.blockNumber }),
      });
    const disputeWindow = await commerce.disputeWindow();
    const settleAt = job.submittedAt + disputeWindow;
    if (BigInt(Math.floor(Date.now() / 1000)) <= settleAt) {
      log({
        event: "activation_waiting_for_settlement_window",
        activationId: activation.activation.id,
        settleAt: settleAt.toString(),
      });
      return;
    }
    await onboarding.transitionActivationLifecycle({
      activationId: activation.activation.id,
      from: "DELIVERED",
      to: "SETTLING",
      evidence: { disputeWindow: disputeWindow.toString() },
    });
    const hash = await commerce.settle(jobId, "0x");
    const settlementEvidence = commerce.drainEvidence();
    const settlementWrite = settlementEvidence.at(-1);
    const settlementBlock =
      settlementWrite?.blockNumber === undefined
        ? undefined
        : BigInt(settlementWrite.blockNumber);
    await supply.transitionActivation({
      activationId: activation.activation.id,
      status: "COMPLETED",
      transactionHash: hash,
      ...(settlementBlock === undefined
        ? {}
        : { blockNumber: settlementBlock }),
      externalJobId: jobId.toString(),
      resultReference: job.deliverable,
      commerceAddress: routing.commerce,
      ...(clientAddress === undefined ? {} : { clientAddress }),
      providerAddress: activation.activation.providerAddress,
      evaluatorAddress: routing.router,
      evidence: {
        operation: "settle",
        source: "sdk-0.5.0",
        writes: settlementEvidence,
        routing,
      },
    });
    await onboarding.transitionActivationLifecycle({
      activationId: activation.activation.id,
      from: "SETTLING",
      to: "COMPLETED",
      transactionHash: hash,
      ...(settlementBlock === undefined
        ? {}
        : { blockNumber: settlementBlock }),
      evidence: {
        state: "COMPLETED",
        observedCost: "0",
        writes: settlementEvidence,
      },
    });
    await recordVerifiedCommerce(activation.service.id, {
      source: "real-settled-erc8183-commerce",
      jobId: jobId.toString(),
      deliverable: job.deliverable,
      writes: settlementEvidence,
      routing,
      observedCost: "0",
    });
  }
  await onboarding.recordOutcome({
    activationId: activation.activation.id,
    agentId: activation.activation.agentId,
    serviceId: activation.activation.serviceId,
    invocationSuccessful: true,
    commerceSuccessful: true,
    responseStatus: "delivered",
    deliveredAt: new Date(Number(job.submittedAt) * 1000),
    settlementState: "COMPLETED",
    observedCost: "0",
    protocolEvidence: {
      dataKind: "real-persisted-commerce",
      jobId: jobId.toString(),
      deliverable: job.deliverable,
      sdkVersion: "0.5.0",
    },
  });
  log({
    event: "activation_completed",
    activationId: activation.activation.id,
    jobId: jobId.toString(),
    observedCost: "0",
  });
}

try {
  const resumeId = arg("activation-id");
  if (resumeId) {
    const activation = await supply.findActivation(resumeId);
    if (!activation) throw new Error(`Activation ${resumeId} not found`);
    await settleOrCheckpoint(activation);
  } else {
    const serviceId = required("service-id");
    const account = required("account");
    const selected = (await supply.referenceCommerceCandidates(100)).find(
      ({ service, candidate }) =>
        service.id === serviceId && candidate.supplyType === "relic_reference",
    );
    if (!selected)
      throw new Error(
        "Service must be an available, PAYMENT_UNDERSTOOD Relic reference candidate",
      );
    if (!selected.service.endpoint)
      throw new Error("Service has no observed ERC-8183 endpoint");
    const providerAddress = selected.identity.ownerAddress as `0x${string}`;
    const clientAddress = arg("wallet-address");
    const commerce = await providerFor({
      providerAddress,
      sellerUrl: selected.service.endpoint,
    });
    const status = await commerce.inspectSeller();
    const request = {
      task_description: JSON.stringify({
        account,
        protocol: "venus-core",
        chainId: 97,
        ...(arg("warning-threshold-raw")
          ? { warningThresholdRaw: arg("warning-threshold-raw") }
          : {}),
      }),
      terms: {
        deliverables: "Relic health-factor analysis schema v1.0 JSON",
        quality_standards:
          "Read-only Venus evidence with chain and observed block",
        success_criteria: ["source is onchain", "readOnly is true"],
        price: "0",
      },
    };
    const negotiated = await commerce.negotiate(request);
    const response = negotiated.response as Record<string, unknown> | undefined;
    const terms = response?.terms as Record<string, unknown> | undefined;
    if (response?.accepted !== true || terms?.price !== "0")
      throw new Error("Seller did not accept exact zero-price terms");
    await recordVerifiedInvocation(selected, {
      source: "real-seller-status-and-negotiation",
      sellerStatus: status,
      negotiationHash: negotiated.negotiation_hash,
      providerSignature: negotiated.provider_sig,
      zeroPrice: true,
    });
    const description = buildJobDescription(negotiated);
    const disputeWindow = await commerce.disputeWindow();
    const expiresAt =
      BigInt(Math.floor(Date.now() / 1000)) + disputeWindow + 600n;
    const routing = commerce.routingAddresses();
    const activationId = await supply.createActivation({
      agentId: selected.service.agentId,
      serviceId: selected.service.id,
      chainId: 97,
      commerceAddress: routing.commerce,
      ...(clientAddress === undefined ? {} : { clientAddress }),
      providerAddress,
      evaluatorAddress: routing.router,
      budget: "0",
      currencyToken: String(status.currency),
      descriptionHash: keccak256(stringToHex(description)),
      evidence: {
        dataKind: "real-live-attempt",
        negotiated,
        sdkVersion: "0.5.0",
      },
    });
    await onboarding.transitionActivationLifecycle({
      activationId,
      from: "PREPARING",
      to: "NEGOTIATING",
      evidence: { sellerStatus: status, zeroPrice: true },
    });
    const prepared = await commerce.prepareJob({
      provider: providerAddress,
      evaluator: routing.router,
      expiresAt,
      description,
      hook: routing.router,
      budget: 0n,
    });
    const jobId = await commerce.createJob(prepared);
    const creationEvidence = commerce.drainEvidence();
    const createHash = creationEvidence[0]?.transactionHash;
    const createBlock = creationEvidence[0]?.blockNumber;
    if (createHash === undefined)
      throw new Error("createJob write evidence missing");
    await supply.transitionActivation({
      activationId,
      status: "JOB_CREATED",
      externalJobId: jobId.toString(),
      transactionHash: createHash,
      ...(createBlock === undefined
        ? {}
        : { blockNumber: BigInt(createBlock) }),
      evidence: { writes: creationEvidence },
    });
    await onboarding.transitionActivationLifecycle({
      activationId,
      from: "NEGOTIATING",
      to: "ONCHAIN_CREATED",
      evidence: { jobId: jobId.toString(), writes: creationEvidence },
      transactionHash: createHash,
      ...(createBlock === undefined
        ? {}
        : { blockNumber: BigInt(createBlock) }),
    });
    await commerce.registerJob(jobId);
    await commerce.setBudget(jobId, 0n);
    await commerce.fundJob(jobId, 0n);
    const fundingEvidence = commerce.drainEvidence();
    const fundHash = fundingEvidence.at(-1)?.transactionHash;
    const fundBlock = fundingEvidence.at(-1)?.blockNumber;
    if (fundHash === undefined)
      throw new Error("fund(0) write evidence missing");
    await supply.transitionActivation({
      activationId,
      status: "FUNDED",
      externalJobId: jobId.toString(),
      transactionHash: fundHash,
      ...(fundBlock === undefined ? {} : { blockNumber: BigInt(fundBlock) }),
      evidence: { writes: fundingEvidence, tokenTransferAmount: "0" },
    });
    await onboarding.transitionActivationLifecycle({
      activationId,
      from: "ONCHAIN_CREATED",
      to: "ACTIVE",
      evidence: { writes: fundingEvidence, budget: "0" },
      transactionHash: fundHash,
      ...(fundBlock === undefined ? {} : { blockNumber: BigInt(fundBlock) }),
    });
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const refreshed = await commerce.refreshJob(jobId);
      if (refreshed.state === "SUBMITTED") break;
      await sleep(5_000);
    }
    const persisted = await supply.findActivation(activationId);
    if (!persisted) throw new Error("Persisted activation disappeared");
    await settleOrCheckpoint(persisted);
    log({
      event: "activation_checkpoint_saved",
      activationId,
      jobId: jobId.toString(),
      resume: `pnpm commerce:live:health-factor -- --activation-id=${activationId} --wallets-dir=...`,
    });
  }
} finally {
  await connection.close();
}
