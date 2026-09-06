import type {
  AgentReadRepository,
  CreateMandateRequest,
  Mandate,
  MandatePersistence,
  VerifiedMandateProfile,
} from "@relic/domain";
import {
  assertExecutionAuthorized,
  createMandateRequestSchema,
  humanReadableMandate,
  mandateEvidenceBinding,
  mandateProfileForAgent,
  MandateValidationError,
  validateMandateConfiguration,
} from "@relic/domain";

export class MandateApplicationService {
  public constructor(
    private readonly agents: AgentReadRepository,
    private readonly mandates: MandatePersistence,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async activationProfile(agentId: string) {
    const agent = await this.#actionableAgent(agentId);
    const profile = mandateProfileForAgent(agent, this.now());
    return {
      profile,
      template:
        agent.category === "health-factor-monitoring"
          ? this.#healthFactorTemplate(agent.id, agent.chainId)
          : null,
    };
  }

  public async create(
    principalId: string,
    request: CreateMandateRequest,
    principalType: Mandate["principalType"] = "DEVELOPMENT_SESSION",
  ) {
    const parsed = createMandateRequestSchema.parse(request);
    const agent = await this.#actionableAgent(parsed.agentId);
    const profile = mandateProfileForAgent(agent, this.now());
    const configuration = validateMandateConfiguration(
      parsed,
      profile,
      this.now(),
    );
    return this.mandates.createMandate({
      principalId,
      principalType,
      profile,
      configuration,
      evidence: mandateEvidenceBinding(agent, profile),
    });
  }

  public async get(principalId: string, id: string) {
    const mandate = await this.#mandate(principalId, id);
    return this.#refreshSafety(mandate);
  }

  public async list(principalId: string) {
    const items = await this.mandates.listMandates(principalId);
    return Promise.all(
      items.map(async (item) => ({
        ...item,
        mandate: await this.#refreshSafety(item.mandate),
      })),
    );
  }

  public async review(principalId: string, id: string) {
    const mandate = await this.#mandate(principalId, id);
    const profile = await this.#currentProfile(mandate);
    this.#validateStoredVersion(mandate, profile);
    return this.#transition({
      id,
      principalId,
      from: ["DRAFT"],
      to: "REVIEWED",
      event: "MANDATE_REVIEWED",
      details: {
        preflightPassed: true,
        serviceId: profile.serviceId,
        verificationTimestamp: profile.verificationTimestamp,
      },
    });
  }

  public async activate(
    principalId: string,
    id: string,
    explicitlyApproved: boolean,
  ) {
    if (!explicitlyApproved)
      throw new MandateValidationError(
        "explicit_approval_required",
        "Activation requires explicit approval of the reviewed mandate.",
      );
    const mandate = await this.#mandate(principalId, id);
    if (
      "positionTokenId" in mandate.version.riskConstraints &&
      mandate.authorizationBoundary !== "WALLET_AUTHORIZED"
    )
      throw new MandateValidationError(
        "buyer_wallet_authorization_required",
        "Grant the buyer-owned Altana trading permission before activating this rebalancer.",
      );
    const profile = await this.#currentProfile(mandate);
    this.#validateStoredVersion(mandate, profile);
    return this.#transition({
      id,
      principalId,
      from: ["REVIEWED"],
      to: "ACTIVE",
      event: "MANDATE_ACTIVATED",
      activateCurrentVersion: true,
      details: {
        policyActivated: true,
        walletAuthorization: false,
        commerceJobCreated: false,
        blockchainTransactionAttempted: false,
      },
    });
  }

  /** Called only after the API has verified the buyer's Altana key on-chain. */
  public async activateAfterWalletAuthorization(
    principalId: string,
    id: string,
    evidence: { walletAddress: string; sessionPublicKey: string; transactionHash: string },
  ) {
    const marked = await this.mandates.setAuthorizationBoundary({
      id,
      principalId,
      boundary: "WALLET_AUTHORIZED",
      event: "ALTANA_SESSION_GRANTED",
      details: {
        walletAddress: evidence.walletAddress,
        sessionPublicKey: evidence.sessionPublicKey,
        transactionHash: evidence.transactionHash,
        buyerAdminPrivateKeyStored: false,
      },
    });
    if (marked === null)
      throw new MandateValidationError("mandate_not_found", "Mandate not found.");
    return this.activate(principalId, id, true);
  }

  public async pause(principalId: string, id: string) {
    return this.#transition({
      id,
      principalId,
      from: ["ACTIVE"],
      to: "PAUSED",
      event: "MANDATE_PAUSED",
      details: { executionBlocked: true },
    });
  }

  public async resume(principalId: string, id: string) {
    const mandate = await this.#mandate(principalId, id);
    const profile = await this.#currentProfile(mandate);
    this.#validateStoredVersion(mandate, profile);
    return this.#transition({
      id,
      principalId,
      from: ["PAUSED"],
      to: "ACTIVE",
      event: "MANDATE_RESUMED",
      details: { safetyPreflightPassed: true },
    });
  }

  public async revoke(principalId: string, id: string) {
    return this.#transition({
      id,
      principalId,
      from: ["DRAFT", "REVIEWED", "ACTIVE", "PAUSED", "FAILED_ACTIVATION"],
      to: "REVOKED",
      event: "MANDATE_REVOKED",
      details: { executionBlockedPermanently: true },
    });
  }

  public async edit(
    principalId: string,
    id: string,
    request: CreateMandateRequest,
  ) {
    const mandate = await this.#mandate(principalId, id);
    if (
      request.agentId !== mandate.agentId ||
      request.chainId !== mandate.chainId
    )
      throw new MandateValidationError(
        "immutable_identity",
        "Editing cannot change the mandate agent or network.",
      );
    const agent = await this.#actionableAgent(mandate.agentId);
    const profile = mandateProfileForAgent(agent, this.now());
    const configuration = validateMandateConfiguration(
      request,
      profile,
      this.now(),
    );
    const updated = await this.mandates.createMandateVersion({
      id,
      principalId,
      profile,
      configuration,
      evidence: mandateEvidenceBinding(agent, profile),
    });
    if (updated === null)
      throw new MandateValidationError(
        "invalid_transition",
        "Only reviewed, active, or paused mandates can be versioned.",
      );
    return updated;
  }

  public async executionPreflight(
    principalId: string,
    id: string,
    request: {
      capability: string;
      asset?: string;
      amount?: string;
      aggregateUsed?: string;
    },
  ) {
    const mandate = await this.#mandate(principalId, id);
    let profile: VerifiedMandateProfile;
    try {
      profile = await this.#currentProfile(mandate);
    } catch (error) {
      await this.mandates.markAttentionRequired({
        id,
        principalId,
        reason:
          error instanceof Error
            ? error.message
            : "Current verification evidence is unavailable.",
      });
      throw error;
    }
    this.#assertEvidenceUnchanged(mandate, profile);
    const result = assertExecutionAuthorized({
      mandate,
      profile,
      capability: request.capability,
      ...(request.asset === undefined ? {} : { asset: request.asset }),
      ...(request.amount === undefined ? {} : { amount: request.amount }),
      ...(request.aggregateUsed === undefined
        ? {}
        : { aggregateUsed: request.aggregateUsed }),
      now: this.now(),
    });
    return {
      ...result,
      policyConfigured: true,
      walletAuthorization: false,
      commerceJobCreated: false,
      blockchainTransactionAttempted: false,
    };
  }

  public preview(mandate: Mandate, agentName: string, network: string) {
    return humanReadableMandate(agentName, network, mandate.version);
  }

  async #actionableAgent(agentId: string) {
    const agent =
      this.agents.findPublicMarketplaceAgent === undefined
        ? null
        : await this.agents.findPublicMarketplaceAgent(agentId);
    if (agent === null || agent.tier !== "Actionable")
      throw new MandateValidationError(
        "agent_not_actionable",
        "The agent is not currently public-eligible and Actionable.",
      );
    return agent;
  }

  async #mandate(principalId: string, id: string) {
    const mandate = await this.mandates.findMandate(id, principalId);
    if (mandate === null)
      throw new MandateValidationError(
        "mandate_not_found",
        "Mandate not found for this principal.",
      );
    return mandate;
  }

  async #currentProfile(mandate: Mandate) {
    const agent = await this.#actionableAgent(mandate.agentId);
    return mandateProfileForAgent(agent, this.now());
  }

  async #refreshSafety(mandate: Mandate) {
    if (
      new Date(mandate.version.expiresAt) <= this.now() &&
      !["REVOKED", "EXPIRED", "SUPERSEDED"].includes(mandate.status)
    )
      return (
        (await this.mandates.transitionMandate({
          id: mandate.id,
          principalId: mandate.principalId,
          from: [mandate.status],
          to: "EXPIRED",
          event: "MANDATE_EXPIRED",
          securitySensitive: true,
          details: { executionBlocked: true },
        })) ?? mandate
      );
    if (
      !(["ACTIVE", "PAUSED"] as const).includes(
        mandate.status as "ACTIVE" | "PAUSED",
      )
    )
      return mandate;
    try {
      const profile = await this.#currentProfile(mandate);
      this.#assertEvidenceUnchanged(mandate, profile);
      return mandate;
    } catch (error) {
      return (
        (await this.mandates.markAttentionRequired({
          id: mandate.id,
          principalId: mandate.principalId,
          reason:
            error instanceof Error
              ? error.message
              : "Current verification evidence is unavailable.",
        })) ?? mandate
      );
    }
  }

  #assertEvidenceUnchanged(mandate: Mandate, profile: VerifiedMandateProfile) {
    if (
      mandate.version.evidence.serviceId !== profile.serviceId ||
      mandate.version.evidence.chainId !== profile.chainId
    )
      throw new MandateValidationError(
        "verification_context_changed",
        "The verified service or network changed after this mandate version was created. Create and approve a new version.",
      );
  }

  #validateStoredVersion(mandate: Mandate, profile: VerifiedMandateProfile) {
    this.#assertEvidenceUnchanged(mandate, profile);
    validateMandateConfiguration(
      {
        agentId: mandate.agentId,
        chainId: mandate.chainId,
        objective: mandate.version.objective,
        allowedCapabilities: mandate.version.allowedCapabilities,
        deniedCapabilities: mandate.version.deniedCapabilities,
        allowedAssets: mandate.version.allowedAssets,
        allowedProtocols: mandate.version.allowedProtocols,
        allowedContracts: mandate.version.allowedContracts,
        perActionLimit: mandate.version.perActionLimit,
        aggregateLimit: mandate.version.aggregateLimit,
        executionFrequency: mandate.version.executionFrequency,
        startAt: mandate.version.startAt,
        expiresAt: mandate.version.expiresAt,
        approvalMode: mandate.version.approvalMode,
        riskConstraints: mandate.version.riskConstraints,
        stopConditions: mandate.version.stopConditions,
      },
      profile,
      this.now(),
    );
  }

  async #transition(
    input: Omit<
      Parameters<MandatePersistence["transitionMandate"]>[0],
      "securitySensitive"
    >,
  ) {
    const mandate = await this.mandates.transitionMandate({
      ...input,
      securitySensitive: true,
    });
    if (mandate === null)
      throw new MandateValidationError(
        "invalid_transition",
        "The mandate is not in a state that permits this transition.",
      );
    return mandate;
  }

  #healthFactorTemplate(agentId: string, chainId: 56 | 97) {
    const startAt = this.now();
    const expiresAt = new Date(startAt.getTime() + 7 * 86_400_000);
    return {
      agentId,
      chainId,
      objective:
        "Monitor my Venus lending position and alert me when health factor falls below 1.30.",
      allowedCapabilities: [
        "monitor_positions",
        "calculate_health_factor",
        "generate_alerts",
      ],
      deniedCapabilities: [...transactionCapabilitiesForTemplate],
      allowedAssets: [],
      allowedProtocols: ["Venus"],
      allowedContracts: [],
      perActionLimit: null,
      aggregateLimit: null,
      executionFrequency: null,
      startAt: startAt.toISOString(),
      expiresAt: expiresAt.toISOString(),
      approvalMode: "OBSERVE_ONLY" as const,
      riskConstraints: { alertHealthFactorBelow: "1.30" },
      stopConditions: [
        { kind: "SERVICE_STALE" },
        { kind: "MANDATE_EXPIRED" },
        { kind: "USER_PAUSED_OR_REVOKED" },
      ],
    } satisfies CreateMandateRequest;
  }
}

const transactionCapabilitiesForTemplate = [
  "transfer_tokens",
  "borrow_assets",
  "repay_debt",
  "swap_assets",
  "approve_contracts",
  "submit_transactions",
];
