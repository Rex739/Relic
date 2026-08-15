import { buildJobDescription } from "@bnbagent/sdk/erc8183";
import {
  createDatabase,
  DrizzleOnboardingStore,
  DrizzleSupplyStore,
} from "@relic/database";
import { keccak256, stringToHex } from "viem";

import { SdkErc8183CommerceProvider } from "./sdk-commerce.js";

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
  console.info(JSON.stringify(value));
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
  const jobId = BigInt(activation.activation.externalJobId);
  const job = await commerce.refreshJob(jobId);
  if (job.state !== "SUBMITTED" && job.state !== "COMPLETED") {
    log({
      event: "activation_checkpoint",
      activationId: activation.activation.id,
      job,
    });
    return;
  }
  if (job.state === "SUBMITTED") {
    if (activation.activation.lifecycleState === "ACTIVE")
      await onboarding.transitionActivationLifecycle({
        activationId: activation.activation.id,
        from: "ACTIVE",
        to: "DELIVERED",
        evidence: {
          source: "onchain-read",
          deliverable: job.deliverable,
          submittedAt: job.submittedAt.toString(),
        },
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
    await supply.transitionActivation({
      activationId: activation.activation.id,
      status: "COMPLETED",
      transactionHash: hash,
      externalJobId: jobId.toString(),
      resultReference: job.deliverable,
      evidence: { operation: "settle", source: "sdk-0.5.0" },
    });
    await onboarding.transitionActivationLifecycle({
      activationId: activation.activation.id,
      from: "SETTLING",
      to: "COMPLETED",
      transactionHash: hash,
      evidence: { state: "COMPLETED", observedCost: "0" },
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
    const selected = (await supply.activationCandidates(100)).find(
      ({ service, candidate }) =>
        service.id === serviceId && candidate.supplyType === "relic_reference",
    );
    if (!selected)
      throw new Error(
        "Service must be a COMMERCE_VERIFIED, ACTIONABLE Relic reference candidate",
      );
    if (!selected.service.endpoint)
      throw new Error("Service has no observed ERC-8183 endpoint");
    const providerAddress = selected.identity.ownerAddress as `0x${string}`;
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
      providerAddress,
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
    if (createHash === undefined)
      throw new Error("createJob write evidence missing");
    await supply.transitionActivation({
      activationId,
      status: "JOB_CREATED",
      externalJobId: jobId.toString(),
      transactionHash: createHash,
      evidence: { writes: creationEvidence },
    });
    await onboarding.transitionActivationLifecycle({
      activationId,
      from: "NEGOTIATING",
      to: "ONCHAIN_CREATED",
      evidence: { jobId: jobId.toString(), writes: creationEvidence },
      transactionHash: createHash,
    });
    await commerce.registerJob(jobId);
    await commerce.setBudget(jobId, 0n);
    await commerce.fundJob(jobId, 0n);
    const fundingEvidence = commerce.drainEvidence();
    const fundHash = fundingEvidence.at(-1)?.transactionHash;
    if (fundHash === undefined)
      throw new Error("fund(0) write evidence missing");
    await supply.transitionActivation({
      activationId,
      status: "FUNDED",
      externalJobId: jobId.toString(),
      transactionHash: fundHash,
      evidence: { writes: fundingEvidence, tokenTransferAmount: "0" },
    });
    await onboarding.transitionActivationLifecycle({
      activationId,
      from: "ONCHAIN_CREATED",
      to: "ACTIVE",
      evidence: { writes: fundingEvidence, budget: "0" },
      transactionHash: fundHash,
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
