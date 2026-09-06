import { randomUUID } from "node:crypto";

import type {
  AgentReadRepository,
  ExecutionActionRequest,
  ExecutionPersistence,
  ExecutionReceipt,
  ExecutionRecord,
  MandatePersistence,
  VerifiedMandateProfile,
} from "@relic/domain";
import {
  evaluateExecutionPolicy,
  executionActionRequestSchema,
  mandateProfileForAgent,
  MandateValidationError,
  normalizedActionHash,
} from "@relic/domain";
import { createPublicClient, getAddress, http } from "viem";

import { PartialLpRebalanceError } from "./pancake-lp-rebalance-executor.js";

const readOnlyCapabilities = new Set([
  "monitor_positions",
  "calculate_health_factor",
  "generate_alerts",
  "generate_recommendations",
]);
const transactionalCapabilities = new Set([
  "transfer_tokens",
  "borrow_assets",
  "repay_debt",
  "swap_assets",
  "approve_contracts",
  "submit_transactions",
]);

export interface TransactionalExecutionAdapter {
  supports(record: ExecutionRecord): boolean;
  execute(record: ExecutionRecord): Promise<ExecutionReceipt>;
}
const comptrollerAbi = [
  {
    type: "function",
    name: "getAccountLiquidity",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [
      { name: "error", type: "uint256" },
      { name: "liquidity", type: "uint256" },
      { name: "shortfall", type: "uint256" },
    ],
  },
  {
    type: "function",
    name: "getAssetsIn",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "markets", type: "address[]" }],
  },
] as const;

export class ExecutionApplicationService {
  public constructor(
    private readonly agents: AgentReadRepository,
    private readonly mandates: MandatePersistence,
    private readonly executions: ExecutionPersistence,
    private readonly environment: {
      bscTestnetRpcUrl?: string;
      venusBscTestnetComptroller?: string;
    },
    private readonly transactionalExecutor?: TransactionalExecutionAdapter,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async request(
    principalId: string,
    mandateId: string,
    idempotencyKey: string,
    raw: unknown,
  ) {
    const mandate = await this.#mandate(principalId, mandateId);
    const parsed = executionActionRequestSchema.parse(raw);
    if (
      parsed.mandateId !== mandate.id ||
      parsed.agentId !== mandate.agentId ||
      parsed.mandateVersion !== mandate.currentVersion
    )
      throw new MandateValidationError(
        "execution_identity_mismatch",
        "The execution identity or mandate version does not match the persisted mandate.",
      );
    const requestedAt = this.now().toISOString();
    const normalizedRequest: ExecutionActionRequest = {
      ...parsed,
      actionType: parsed.actionType
        .trim()
        .toLowerCase()
        .replaceAll(/[\s-]+/g, "_"),
      capability: parsed.capability
        .trim()
        .toLowerCase()
        .replaceAll(/[\s-]+/g, "_"),
      protocol: parsed.protocol?.trim() ?? null,
      target: parsed.target?.trim() ?? null,
      asset: parsed.asset?.trim().toUpperCase() ?? null,
    };
    const action = {
      ...normalizedRequest,
      id: randomUUID(),
      principalId,
      requestedAt,
      normalizedHash: normalizedActionHash(normalizedRequest, principalId),
      transactional:
        transactionalCapabilities.has(normalizedRequest.capability) ||
        normalizedRequest.amount !== null ||
        normalizedRequest.destination !== null,
    };
    const persisted = await this.executions.createOrFind({
      id: action.id,
      idempotencyKey,
      principalId,
      rawRequest: raw as Record<string, unknown>,
      action,
    });
    if (!persisted.created) return persisted.record;

    const profile = await this.#profile(mandate);
    const windowSeconds =
      mandate.version.executionFrequency?.windowSeconds ?? 31_536_000;
    const budget = await this.executions.budgetState(
      mandate.id,
      mandate.version.version,
      new Date(this.now().getTime() - windowSeconds * 1_000),
    );
    const decision = evaluateExecutionPolicy({
      mandate,
      profile,
      action,
      budget,
      now: this.now(),
    });
    let record = await this.executions.recordDecision({
      executionId: action.id,
      result: decision,
      reserveAmount: action.transactional ? action.amount : null,
      aggregateLimit: mandate.version.aggregateLimit?.amount ?? null,
    });
    if (record.status === "APPROVED")
      record = action.transactional
        ? await this.#executeTransaction(record)
        : await this.#executeReadOnly(record, profile);
    return record;
  }

  public async list(principalId: string, mandateId: string) {
    await this.#mandate(principalId, mandateId);
    return this.executions.list(mandateId, principalId);
  }

  public async get(principalId: string, executionId: string) {
    const record = await this.executions.find(executionId, principalId);
    if (record === null)
      throw new MandateValidationError(
        "execution_not_found",
        "Execution not found.",
      );
    if (record.status === "APPROVED") return this.#executeTransaction(record);
    return record;
  }

  async #executeTransaction(record: ExecutionRecord) {
    if (this.transactionalExecutor === undefined || !this.transactionalExecutor.supports(record))
      return record;
    const prior = await this.executions.list(record.mandateId, record.principalId);
    const cutoff = this.now().getTime() - 3_600_000;
    if (
      prior.some(
        (candidate) =>
          candidate.id !== record.id &&
          candidate.status === "SUCCEEDED" &&
          candidate.action.actionType === "rebalance_liquidity" &&
          candidate.completedAt !== null &&
          Date.parse(candidate.completedAt) > cutoff,
      )
    ) {
      const receipt: ExecutionReceipt = {
        source: "onchain_verified",
        outcome: { success: false, message: "The one-hour rebalance cooldown is active." },
        evidence: { blockchainWrite: false, walletAuthorization: true, cooldownSeconds: 3_600 },
        cost: null,
        transactionHash: null,
        jobId: null,
        observedAt: this.now().toISOString(),
      };
      const failed = await this.executions.transition({
        executionId: record.id,
        principalId: record.principalId,
        from: ["APPROVED"],
        to: "FAILED",
        receipt,
        evidence: receipt.evidence,
      });
      return failed ?? record;
    }
    const executing = await this.executions.transition({
      executionId: record.id,
      principalId: record.principalId,
      from: ["APPROVED"],
      to: "EXECUTING",
      evidence: { executor: "pancakeswap_v3_lp_rebalancer" },
    });
    if (executing === null) return record;
    try {
      const receipt = await this.transactionalExecutor.execute(executing);
      const completed = await this.executions.transition({
        executionId: record.id,
        principalId: record.principalId,
        from: ["EXECUTING"],
        to: "SUCCEEDED",
        receipt,
        evidence: receipt.evidence,
      });
      if (completed === null) throw new Error("Execution completion transition failed");
      return completed;
    } catch (error) {
      const receipt: ExecutionReceipt = error instanceof PartialLpRebalanceError
        ? error.receipt(this.now().toISOString())
        : {
            source: "onchain_verified",
            outcome: {
              success: false,
              message: error instanceof Error ? error.message : "PancakeSwap LP rebalance failed",
            },
            evidence: { blockchainWrite: false, walletAuthorization: true },
            cost: null,
            transactionHash: null,
            jobId: null,
            observedAt: this.now().toISOString(),
          };
      const failed = await this.executions.transition({
        executionId: record.id,
        principalId: record.principalId,
        from: ["EXECUTING"],
        to: "FAILED",
        receipt,
        evidence: receipt.evidence,
      });
      if (failed === null) throw error;
      return failed;
    }
  }

  public async approve(
    principalId: string,
    executionId: string,
    normalizedHash: string,
    approved: boolean,
  ) {
    const record = await this.executions.approve({
      executionId,
      principalId,
      normalizedHash,
      approved,
    });
    if (record === null)
      throw new MandateValidationError(
        "approval_replay_or_mismatch",
        "Approval was already used, the action hash changed, or the action is not awaiting approval.",
      );
    return record;
  }

  async #executeReadOnly(
    record: Awaited<ReturnType<ExecutionPersistence["find"]>> & {},
    profile: VerifiedMandateProfile,
  ) {
    if (!readOnlyCapabilities.has(record.action.capability))
      throw new MandateValidationError(
        "executor_unavailable",
        "No read-only executor supports this capability.",
      );
    const executing = await this.executions.transition({
      executionId: record.id,
      principalId: record.principalId,
      from: ["APPROVED"],
      to: "EXECUTING",
      evidence: { serviceId: profile.serviceId },
    });
    if (executing === null) return record;
    try {
      const receipt = await this.#observeVenus(executing, profile);
      const completed = await this.executions.transition({
        executionId: record.id,
        principalId: record.principalId,
        from: ["EXECUTING"],
        to: "SUCCEEDED",
        receipt,
        evidence: receipt.evidence,
      });
      if (completed === null)
        throw new Error("Execution completion transition failed");
      return completed;
    } catch (error) {
      const receipt: ExecutionReceipt = {
        source: "independently_observed",
        outcome: {
          success: false,
          message:
            error instanceof Error
              ? error.message
              : "Read-only execution failed",
        },
        evidence: { blockchainWrite: false, walletAuthorization: false },
        cost: "0",
        transactionHash: null,
        jobId: null,
        observedAt: this.now().toISOString(),
      };
      const failed = await this.executions.transition({
        executionId: record.id,
        principalId: record.principalId,
        from: ["EXECUTING"],
        to: "FAILED",
        receipt,
        evidence: receipt.evidence,
      });
      if (failed === null) throw error;
      return failed;
    }
  }

  async #observeVenus(
    record: NonNullable<Awaited<ReturnType<ExecutionPersistence["find"]>>>,
    profile: VerifiedMandateProfile,
  ): Promise<ExecutionReceipt> {
    if (record.chainId !== 97)
      throw new Error("The current read-only executor is BSC Testnet-only");
    const rpcUrl = this.environment.bscTestnetRpcUrl;
    const comptrollerValue = this.environment.venusBscTestnetComptroller;
    if (rpcUrl === undefined || comptrollerValue === undefined)
      throw new Error("BSC Testnet RPC and Venus Comptroller are required");
    const accountValue = record.action.parameters.account;
    if (typeof accountValue !== "string")
      throw new Error("A public observation account is required");
    const serviceStatusUrl = new URL(profile.serviceEndpoint);
    serviceStatusUrl.pathname = `${serviceStatusUrl.pathname.replace(/\/$/, "")}/status`;
    const serviceResponse = await fetch(serviceStatusUrl, {
      method: "GET",
      signal: AbortSignal.timeout(8_000),
    });
    if (!serviceResponse.ok)
      throw new Error(
        `Verified service preflight returned HTTP ${serviceResponse.status}`,
      );
    const client = createPublicClient({ transport: http(rpcUrl) });
    const account = getAddress(accountValue);
    const comptroller = getAddress(comptrollerValue);
    const blockNumber = await client.getBlockNumber();
    const [liquidity, markets] = await Promise.all([
      client.readContract({
        address: comptroller,
        abi: comptrollerAbi,
        functionName: "getAccountLiquidity",
        args: [account],
        blockNumber,
      }),
      client.readContract({
        address: comptroller,
        abi: comptrollerAbi,
        functionName: "getAssetsIn",
        args: [account],
        blockNumber,
      }),
    ]);
    if (liquidity[0] !== 0n)
      throw new Error(
        `Venus getAccountLiquidity returned error ${liquidity[0]}`,
      );
    const riskLevel = liquidity[2] > 0n ? "critical" : "none";
    return {
      source: "independently_observed",
      outcome: {
        success: true,
        readOnly: true,
        account,
        protocol: "venus-core",
        riskLevel,
        liquidityRaw: liquidity[1].toString(),
        shortfallRaw: liquidity[2].toString(),
        enteredMarketCount: markets.length,
        noPosition: markets.length === 0,
      },
      evidence: {
        chainId: 97,
        observedBlock: blockNumber.toString(),
        comptroller,
        serviceId: profile.serviceId,
        serviceEndpoint: profile.serviceEndpoint,
        servicePreflightHttpStatus: serviceResponse.status,
        blockchainWrite: false,
        walletAuthorization: false,
      },
      cost: "0",
      transactionHash: null,
      jobId: null,
      observedAt: this.now().toISOString(),
    };
  }

  async #mandate(principalId: string, mandateId: string) {
    const mandate = await this.mandates.findMandate(mandateId, principalId);
    if (mandate === null)
      throw new MandateValidationError(
        "mandate_not_found",
        "Mandate not found.",
      );
    return mandate;
  }

  async #profile(
    mandate: Awaited<ReturnType<MandatePersistence["findMandate"]>> & {},
  ) {
    const agent =
      this.agents.findPublicMarketplaceAgent === undefined
        ? null
        : await this.agents.findPublicMarketplaceAgent(mandate.agentId);
    if (agent === null || agent.tier !== "Actionable") {
      await this.mandates.markAttentionRequired({
        id: mandate.id,
        principalId: mandate.principalId,
        reason: "Agent is no longer public-eligible and Actionable.",
      });
      return {
        agentId: mandate.agentId,
        agentName: "Unavailable agent",
        tier: "Actionable",
        chainId: mandate.chainId,
        network: mandate.chainId === 97 ? "BNB Chain Testnet" : "BNB Chain",
        serviceId: mandate.version.evidence.serviceId,
        serviceEndpoint: mandate.version.evidence.serviceEndpoint,
        serviceVerificationLevel: "INVOCATION_VERIFIED",
        verificationTimestamp: mandate.version.evidence.verificationTimestamp,
        capabilitySet: mandate.version.evidence.capabilitySet,
        supportedAssets: [],
        supportedProtocols: mandate.version.allowedProtocols,
        supportedContracts: mandate.version.allowedContracts,
        approvalModes: [mandate.version.approvalMode],
        transactional: false,
        current: false,
        attentionReason: "Agent is no longer public-eligible and Actionable.",
      } satisfies VerifiedMandateProfile;
    }
    return mandateProfileForAgent(agent, this.now());
  }
}

export class PreparedErc8183Adapter {
  public async prepare() {
    return Promise.resolve({
      negotiation: { prepared: true, requestSent: false },
      jobCreation: { required: true, prepared: true },
      funding: { amount: null, asset: null, required: false },
      providerSubmission: { prepared: true },
      settlement: { prepared: true },
      blockchainWritePrepared: true,
      blockchainWriteSubmitted: false as const,
    });
  }
}
