import type {
  CommerceAuthorization,
  CommerceOperationState,
  CommerceOperationType,
  CreateOfferRequest,
  OfferStatus,
} from "@relic/domain";
import {
  assertAgreementTransition,
  assertOfferTransition,
  exactTokenAmount,
  immutableContentHash,
  assertActivationLifecycleTransition,
  legacyActivationStatusForLifecycle,
  type ActivationLifecycleState,
} from "@relic/domain";
import { and, asc, desc, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";

import type { RelicDatabase } from "./client.js";
import {
  activationLifecycleTransitions,
  activationTransitions,
  activations,
  agentIdentities,
  agentOfferEvents,
  agentOfferVersions,
  agentOffers,
  authorizationArtifacts,
  authorizationChallenges,
  authorizationEvents,
  commerceAgreementEvents,
  commerceAgreementVersions,
  commerceAgreements,
  commerceArtifacts,
  commerceOperations,
  commerceReputationObservations,
  commerceValueMovements,
  executionRequests,
  executionApprovals,
  launchCandidates,
  mandates,
  mandateEvents,
  marketplaceServices,
  settlementRecords,
  walletAuthChallenges,
  walletSessions,
} from "./schema.js";

const asObject = (value: unknown) => (value ?? {}) as Record<string, unknown>;
const strings = (value: unknown) =>
  Array.isArray(value) ? value.map(String) : [];

export class DrizzleWalletAuthStore {
  public constructor(private readonly database: RelicDatabase) {}

  public async createChallenge(input: {
    walletAddress: string;
    chainId: number;
    nonceHash: string;
    message: string;
    expiresAt: Date;
  }) {
    const [row] = await this.database
      .insert(walletAuthChallenges)
      .values(input)
      .returning({ id: walletAuthChallenges.id });
    if (row === undefined) throw new Error("Wallet challenge insert failed");
    return row.id;
  }

  public async consumeChallenge(input: {
    id: string;
    walletAddress: string;
    chainId: number;
    now: Date;
  }) {
    const [row] = await this.database
      .update(walletAuthChallenges)
      .set({ consumedAt: input.now })
      .where(
        and(
          eq(walletAuthChallenges.id, input.id),
          eq(walletAuthChallenges.walletAddress, input.walletAddress),
          eq(walletAuthChallenges.chainId, input.chainId),
          isNull(walletAuthChallenges.consumedAt),
          gt(walletAuthChallenges.expiresAt, input.now),
        ),
      )
      .returning();
    return row ?? null;
  }

  public async findChallenge(id: string) {
    const [row] = await this.database
      .select()
      .from(walletAuthChallenges)
      .where(eq(walletAuthChallenges.id, id))
      .limit(1);
    return row ?? null;
  }

  public async createSession(input: {
    principalId: string;
    walletAddress: string;
    chainId: number;
    sessionTokenHash: string;
    expiresAt: Date;
  }) {
    const [row] = await this.database
      .insert(walletSessions)
      .values(input)
      .returning({ id: walletSessions.id });
    if (row === undefined) throw new Error("Wallet session insert failed");
    return row.id;
  }

  public async session(sessionTokenHash: string, now = new Date()) {
    const [row] = await this.database
      .update(walletSessions)
      .set({ lastSeenAt: now })
      .where(
        and(
          eq(walletSessions.sessionTokenHash, sessionTokenHash),
          isNull(walletSessions.revokedAt),
          gt(walletSessions.expiresAt, now),
        ),
      )
      .returning();
    return row ?? null;
  }

  public async revokeSession(sessionTokenHash: string, now = new Date()) {
    const rows = await this.database
      .update(walletSessions)
      .set({ revokedAt: now })
      .where(
        and(
          eq(walletSessions.sessionTokenHash, sessionTokenHash),
          isNull(walletSessions.revokedAt),
        ),
      )
      .returning({ id: walletSessions.id });
    return rows.length === 1;
  }
}

export class DrizzleCommerceStore {
  public constructor(private readonly database: RelicDatabase) {}

  public async createOffer(input: {
    operatorPrincipalId: string;
    operatorAddress: string;
    request: CreateOfferRequest;
  }) {
    const request = input.request;
    const price = exactTokenAmount(request.price);
    if (price.chainId !== request.chainId)
      throw new Error("Offer price network does not match the service network");
    const eligibility = await this.#eligibleOperatorService(
      request.agentId,
      request.serviceId,
      input.operatorAddress,
      request.chainId,
    );
    if (eligibility === null)
      throw new Error(
        "Only the current ERC-8004 owner of an eligible verified service can create an offer",
      );
    const termsHash = immutableContentHash({
      terms: request.terms,
      billingModel: request.billingModel,
      price,
      capability: request.capability,
      capabilitySnapshot: request.capabilitySnapshot,
      limitationsSnapshot: request.limitationsSnapshot,
    });
    const id = await this.database.transaction(async (transaction) => {
      const [offer] = await transaction
        .insert(agentOffers)
        .values({
          operatorPrincipalId: input.operatorPrincipalId,
          agentId: request.agentId,
          serviceId: request.serviceId,
          status: "DRAFT",
          currentVersion: 1,
        })
        .returning({ id: agentOffers.id });
      if (offer === undefined) throw new Error("Offer insert failed");
      const [version] = await transaction
        .insert(agentOfferVersions)
        .values({
          offerId: offer.id,
          version: 1,
          chainId: request.chainId,
          capability: request.capability,
          billingModel: request.billingModel,
          priceBaseUnits: price.amountBaseUnits,
          paymentTokenAddress: price.tokenAddress,
          paymentTokenDecimals: price.decimals,
          currencySymbol: price.symbol,
          termsContent: request.terms,
          termsHash,
          capabilitySnapshot: request.capabilitySnapshot,
          limitationsSnapshot: request.limitationsSnapshot,
          evidenceReference: {
            serviceId: request.serviceId,
            verificationLevel: eligibility.verificationLevel,
            lastVerifiedAt: eligibility.lastVerifiedAt?.toISOString() ?? null,
            ownerAddress: eligibility.ownerAddress,
          },
          effectiveAt: new Date(request.effectiveAt),
          expiresAt:
            request.expiresAt === null ? null : new Date(request.expiresAt),
        })
        .returning({ id: agentOfferVersions.id });
      if (version === undefined) throw new Error("Offer version insert failed");
      await transaction.insert(agentOfferEvents).values({
        offerId: offer.id,
        offerVersionId: version.id,
        eventType: "OFFER_CREATED",
        actorPrincipalId: input.operatorPrincipalId,
        evidence: { termsHash, serviceId: request.serviceId },
      });
      return offer.id;
    });
    return this.findOffer(id);
  }

  public async activateOffer(input: {
    offerId: string;
    operatorPrincipalId: string;
    operatorAddress: string;
  }) {
    const offer = await this.findOffer(input.offerId);
    if (
      offer === null ||
      offer.operatorPrincipalId !== input.operatorPrincipalId
    )
      throw new Error("Offer not found for this operator");
    assertOfferTransition(offer.status, "ACTIVE");
    const eligibility = await this.#eligibleOperatorService(
      offer.agentId,
      offer.serviceId,
      input.operatorAddress,
      offer.version.chainId,
    );
    if (eligibility === null)
      throw new Error("Stale or ineligible services cannot activate offers");
    await this.#transitionOffer(
      offer.id,
      offer.status,
      "ACTIVE",
      input.operatorPrincipalId,
      { serviceLastVerifiedAt: eligibility.lastVerifiedAt?.toISOString() },
    );
    return this.findOffer(offer.id);
  }

  public async transitionOffer(input: {
    offerId: string;
    operatorPrincipalId: string;
    to: Extract<OfferStatus, "PAUSED" | "DEACTIVATED">;
  }) {
    const offer = await this.findOffer(input.offerId);
    if (
      offer === null ||
      offer.operatorPrincipalId !== input.operatorPrincipalId
    )
      throw new Error("Offer not found for this operator");
    assertOfferTransition(offer.status, input.to);
    await this.#transitionOffer(
      offer.id,
      offer.status,
      input.to,
      input.operatorPrincipalId,
      {},
    );
    return this.findOffer(offer.id);
  }

  public async reviseOffer(input: {
    offerId: string;
    operatorPrincipalId: string;
    operatorAddress: string;
    request: CreateOfferRequest;
  }) {
    const offer = await this.findOffer(input.offerId);
    if (
      offer === null ||
      offer.operatorPrincipalId !== input.operatorPrincipalId ||
      offer.agentId !== input.request.agentId ||
      offer.serviceId !== input.request.serviceId ||
      offer.version.chainId !== input.request.chainId ||
      offer.status === "DEACTIVATED" ||
      offer.status === "EXPIRED"
    )
      throw new Error("Offer cannot be revised by this operator");
    const eligibility = await this.#eligibleOperatorService(
      offer.agentId,
      offer.serviceId,
      input.operatorAddress,
      offer.version.chainId,
    );
    if (eligibility === null)
      throw new Error("Offer service is no longer eligible");
    const price = exactTokenAmount(input.request.price);
    const termsHash = immutableContentHash({
      terms: input.request.terms,
      billingModel: input.request.billingModel,
      price,
      capability: input.request.capability,
      capabilitySnapshot: input.request.capabilitySnapshot,
      limitationsSnapshot: input.request.limitationsSnapshot,
    });
    const nextVersion = offer.currentVersion + 1;
    await this.database.transaction(async (transaction) => {
      const [version] = await transaction
        .insert(agentOfferVersions)
        .values({
          offerId: offer.id,
          version: nextVersion,
          chainId: input.request.chainId,
          capability: input.request.capability,
          billingModel: input.request.billingModel,
          priceBaseUnits: price.amountBaseUnits,
          paymentTokenAddress: price.tokenAddress,
          paymentTokenDecimals: price.decimals,
          currencySymbol: price.symbol,
          termsContent: input.request.terms,
          termsHash,
          capabilitySnapshot: input.request.capabilitySnapshot,
          limitationsSnapshot: input.request.limitationsSnapshot,
          evidenceReference: {
            serviceId: offer.serviceId,
            verificationLevel: eligibility.verificationLevel,
            lastVerifiedAt: eligibility.lastVerifiedAt?.toISOString() ?? null,
            ownerAddress: eligibility.ownerAddress,
          },
          effectiveAt: new Date(input.request.effectiveAt),
          expiresAt:
            input.request.expiresAt === null
              ? null
              : new Date(input.request.expiresAt),
        })
        .returning({ id: agentOfferVersions.id });
      if (version === undefined)
        throw new Error("Offer revision insert failed");
      const revisedStatus = offer.status === "ACTIVE" ? "PAUSED" : offer.status;
      const changed = await transaction
        .update(agentOffers)
        .set({
          currentVersion: nextVersion,
          status: revisedStatus,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(agentOffers.id, offer.id),
            eq(agentOffers.currentVersion, offer.currentVersion),
          ),
        )
        .returning({ id: agentOffers.id });
      if (changed.length !== 1) throw new Error("Offer changed concurrently");
      await transaction.insert(agentOfferEvents).values({
        offerId: offer.id,
        offerVersionId: version.id,
        eventType: "OFFER_VERSION_CREATED",
        actorPrincipalId: input.operatorPrincipalId,
        evidence: {
          previousVersion: offer.currentVersion,
          newVersion: nextVersion,
          termsHash,
          activationRequired: true,
        },
      });
    });
    return this.findOffer(offer.id);
  }

  public async findOffer(id: string) {
    const [row] = await this.database
      .select({ offer: agentOffers, version: agentOfferVersions })
      .from(agentOffers)
      .innerJoin(
        agentOfferVersions,
        and(
          eq(agentOfferVersions.offerId, agentOffers.id),
          eq(agentOfferVersions.version, agentOffers.currentVersion),
        ),
      )
      .where(eq(agentOffers.id, id))
      .limit(1);
    return row === undefined ? null : this.#offer(row.offer, row.version);
  }

  public async activeOffersForAgent(agentId: string) {
    const now = new Date();
    const rows = await this.database
      .select({ offer: agentOffers, version: agentOfferVersions })
      .from(agentOffers)
      .innerJoin(
        agentOfferVersions,
        and(
          eq(agentOfferVersions.offerId, agentOffers.id),
          eq(agentOfferVersions.version, agentOffers.currentVersion),
        ),
      )
      .innerJoin(
        marketplaceServices,
        eq(marketplaceServices.id, agentOffers.serviceId),
      )
      .where(
        and(
          eq(agentOffers.agentId, agentId),
          eq(agentOffers.status, "ACTIVE"),
          eq(marketplaceServices.availability, "available"),
          inArray(marketplaceServices.verificationLevel, [
            "INVOCATION_VERIFIED",
            "COMMERCE_VERIFIED",
          ]),
          gt(
            marketplaceServices.lastVerifiedAt,
            new Date(now.getTime() - 604_800_000),
          ),
          or(
            isNull(agentOfferVersions.expiresAt),
            gt(agentOfferVersions.expiresAt, now),
          ),
        ),
      )
      .orderBy(asc(agentOffers.createdAt));
    return rows.map((row) => this.#offer(row.offer, row.version));
  }

  public async operatorOffers(operatorPrincipalId: string) {
    const rows = await this.database
      .select({ id: agentOffers.id })
      .from(agentOffers)
      .where(eq(agentOffers.operatorPrincipalId, operatorPrincipalId))
      .orderBy(desc(agentOffers.updatedAt));
    return Promise.all(rows.map(({ id }) => this.findOffer(id)));
  }

  public async operatorAgreements(operatorPrincipalId: string) {
    return this.database
      .select({
        agreement: commerceAgreements,
        offer: agentOffers,
        activation: activations,
        settlement: settlementRecords,
      })
      .from(commerceAgreements)
      .innerJoin(agentOffers, eq(agentOffers.id, commerceAgreements.offerId))
      .leftJoin(
        activations,
        eq(activations.commerceAgreementId, commerceAgreements.id),
      )
      .leftJoin(
        settlementRecords,
        eq(settlementRecords.agreementId, commerceAgreements.id),
      )
      .where(eq(agentOffers.operatorPrincipalId, operatorPrincipalId))
      .orderBy(desc(commerceAgreements.updatedAt));
  }

  public async createAgreement(input: {
    principalId: string;
    offerId: string;
    mandateId: string;
  }) {
    const offer = await this.findOffer(input.offerId);
    if (offer === null || offer.status !== "ACTIVE")
      throw new Error("Only active verified offers can be hired");
    const [mandate] = await this.database
      .select()
      .from(mandates)
      .where(
        and(
          eq(mandates.id, input.mandateId),
          eq(mandates.principalId, input.principalId),
          eq(mandates.agentId, offer.agentId),
          eq(mandates.chainId, offer.version.chainId),
          eq(mandates.status, "ACTIVE"),
        ),
      )
      .limit(1);
    if (mandate === undefined || mandate.activeVersion === null)
      throw new Error("An active matching mandate is required before hiring");
    const pricingSnapshot = offer.version.price;
    const id = await this.database.transaction(async (transaction) => {
      const [agreement] = await transaction
        .insert(commerceAgreements)
        .values({
          principalId: input.principalId,
          agentId: offer.agentId,
          serviceId: offer.serviceId,
          offerId: offer.id,
          offerVersionId: offer.version.id,
          mandateId: mandate.id,
          mandateVersion: mandate.activeVersion,
          status: "DRAFT",
          currentVersion: 1,
          chainId: offer.version.chainId,
          termsHash: offer.version.termsHash,
          termsSnapshot: offer.version.terms,
          pricingSnapshot,
          amountBaseUnits: offer.version.price.amountBaseUnits,
          paymentTokenAddress: offer.version.price.tokenAddress,
          paymentTokenDecimals: offer.version.price.decimals,
          expiresAt:
            offer.version.expiresAt === null
              ? null
              : new Date(offer.version.expiresAt),
        })
        .returning({ id: commerceAgreements.id });
      if (agreement === undefined) throw new Error("Agreement insert failed");
      const [version] = await transaction
        .insert(commerceAgreementVersions)
        .values({
          agreementId: agreement.id,
          version: 1,
          status: "DRAFT",
          offerVersionId: offer.version.id,
          mandateId: mandate.id,
          mandateVersion: mandate.activeVersion,
          termsHash: offer.version.termsHash,
          termsSnapshot: offer.version.terms,
          pricingSnapshot,
        })
        .returning({ id: commerceAgreementVersions.id });
      if (version === undefined)
        throw new Error("Agreement version insert failed");
      await transaction.insert(commerceAgreementEvents).values({
        agreementId: agreement.id,
        agreementVersionId: version.id,
        fromStatus: null,
        toStatus: "DRAFT",
        eventType: "AGREEMENT_CREATED",
        actorPrincipalId: input.principalId,
        evidence: {
          offerVersionId: offer.version.id,
          termsHash: offer.version.termsHash,
          mandateId: mandate.id,
          mandateVersion: mandate.activeVersion,
        },
      });
      return agreement.id;
    });
    return this.findAgreement(id, input.principalId);
  }

  public async acceptTerms(input: {
    agreementId: string;
    principalId: string;
    termsHash: string;
  }) {
    const agreement = await this.#agreementRow(
      input.agreementId,
      input.principalId,
    );
    if (agreement === null) throw new Error("Agreement not found");
    if (agreement.termsHash !== input.termsHash)
      throw new Error("Accepted terms hash does not match the immutable offer");
    assertAgreementTransition(agreement.status, "TERMS_ACCEPTED");
    const now = new Date();
    await this.database.transaction(async (transaction) => {
      const changed = await transaction
        .update(commerceAgreements)
        .set({
          status: "AUTHORIZATION_REQUIRED",
          acceptedAt: now,
          updatedAt: now,
        })
        .where(
          and(
            eq(commerceAgreements.id, agreement.id),
            eq(commerceAgreements.status, "DRAFT"),
          ),
        )
        .returning({ id: commerceAgreements.id });
      if (changed.length !== 1) throw new Error("Agreement state changed");
      await transaction.insert(commerceAgreementEvents).values([
        {
          agreementId: agreement.id,
          fromStatus: "DRAFT",
          toStatus: "TERMS_ACCEPTED",
          eventType: "TERMS_ACCEPTED",
          actorPrincipalId: input.principalId,
          evidence: { termsHash: input.termsHash },
          occurredAt: now,
        },
        {
          agreementId: agreement.id,
          fromStatus: "TERMS_ACCEPTED",
          toStatus: "AUTHORIZATION_REQUIRED",
          eventType: "AUTHORIZATION_REQUIRED",
          actorPrincipalId: input.principalId,
          evidence: { walletAuthorization: false },
          occurredAt: now,
        },
      ]);
      await transaction.insert(commerceArtifacts).values({
        agreementId: agreement.id,
        artifactType: "ACCEPTED_TERMS",
        source: "wallet-authenticated-principal",
        contentHash: input.termsHash,
        safeContent: { termsHash: input.termsHash },
        provenance: "independently_observed",
        observedAt: now,
      });
    });
    return this.findAgreement(agreement.id, input.principalId);
  }

  public async recordAuthorization(input: {
    principalId: string;
    signerAddress: string;
    authorization: CommerceAuthorization;
    signature: string;
    messageHash: string;
    nonceHash: string;
    evidenceReference: Record<string, unknown>;
  }) {
    const agreement = await this.#agreementRow(
      input.authorization.agreementId,
      input.principalId,
    );
    const actionSpecific = input.authorization.actionHash !== null;
    if (
      agreement === null ||
      (actionSpecific
        ? !["AUTHORIZED", "ACTIVE"].includes(agreement.status)
        : agreement.status !== "AUTHORIZATION_REQUIRED")
    )
      throw new Error("Agreement is not awaiting this authorization type");
    if (
      agreement.termsHash !== input.authorization.termsHash ||
      agreement.chainId !== input.authorization.chainId ||
      agreement.paymentTokenAddress.toLowerCase() !==
        input.authorization.tokenAddress.toLowerCase() ||
      agreement.amountBaseUnits !== input.authorization.amountBaseUnits ||
      agreement.mandateId !== input.authorization.mandateId ||
      agreement.mandateVersion !== input.authorization.mandateVersion
    )
      throw new Error("Authorization payload does not match the agreement");
    const expirySeconds = BigInt(input.authorization.expiresAt);
    if (expirySeconds > 8_640_000_000_000n)
      throw new Error(
        "Authorization expiry is outside the supported date range",
      );
    const expiresAt = new Date(Number(expirySeconds) * 1_000);
    if (expirySeconds <= BigInt(Math.floor(Date.now() / 1_000)))
      throw new Error("Authorization expired");
    const actionHash = input.authorization.actionHash?.slice(2) ?? null;
    const [execution] =
      actionHash === null
        ? [undefined]
        : await this.database
            .select()
            .from(executionRequests)
            .where(
              and(
                eq(executionRequests.principalId, input.principalId),
                eq(executionRequests.mandateId, input.authorization.mandateId),
                eq(
                  executionRequests.mandateVersion,
                  input.authorization.mandateVersion,
                ),
                eq(executionRequests.agentId, input.authorization.agentId),
                sql`lower(${executionRequests.normalizedHash}) = lower(${actionHash})`,
                eq(executionRequests.status, "APPROVAL_REQUIRED"),
              ),
            )
            .limit(1);
    if (actionSpecific && execution === undefined)
      throw new Error(
        "Exact execution approval does not match a pending action",
      );
    const artifactId = await this.database.transaction(async (transaction) => {
      const [artifact] = await transaction
        .insert(authorizationArtifacts)
        .values({
          principalId: input.principalId,
          agreementId: agreement.id,
          executionRequestId: execution?.id,
          mandateId: input.authorization.mandateId,
          mandateVersion: input.authorization.mandateVersion,
          authorizationType: "WALLET_SIGNATURE",
          signerAddress: input.signerAddress,
          chainId: input.authorization.chainId,
          normalizedPayload: input.authorization,
          signature: input.signature,
          messageHash: input.messageHash,
          actionHash: input.authorization.actionHash,
          termsHash: input.authorization.termsHash,
          nonceHash: input.nonceHash,
          verificationStatus: "VERIFIED",
          evidenceReference: input.evidenceReference,
          expiresAt,
        })
        .returning({ id: authorizationArtifacts.id });
      if (artifact === undefined)
        throw new Error("Authorization artifact insert failed");
      await transaction.insert(authorizationEvents).values({
        authorizationId: artifact.id,
        eventType: "AUTHORIZATION_VERIFIED",
        verificationStatus: "VERIFIED",
        evidence: input.evidenceReference,
      });
      if (execution !== undefined) {
        const approval = await transaction
          .insert(executionApprovals)
          .values({
            executionRequestId: execution.id,
            principalId: input.principalId,
            normalizedHash: execution.normalizedHash,
            approved: true,
            authorizationKind: "WALLET_EIP712",
            walletAuthorization: true,
          })
          .onConflictDoNothing()
          .returning({ id: executionApprovals.id });
        if (approval.length !== 1)
          throw new Error("Exact execution authorization was already consumed");
        const changedExecution = await transaction
          .update(executionRequests)
          .set({ status: "APPROVED", updatedAt: new Date() })
          .where(
            and(
              eq(executionRequests.id, execution.id),
              eq(executionRequests.status, "APPROVAL_REQUIRED"),
            ),
          )
          .returning({ id: executionRequests.id });
        if (changedExecution.length !== 1)
          throw new Error("Execution changed before approval was recorded");
        await transaction.insert(mandateEvents).values({
          mandateId: execution.mandateId,
          mandateVersionId: null,
          eventType: "EXECUTION_APPROVED",
          securitySensitive: true,
          details: {
            executionId: execution.id,
            authorizationKind: "WALLET_EIP712",
            walletAuthorization: true,
          },
          evidenceReferences: {
            authorizationId: artifact.id,
            normalizedHash: execution.normalizedHash,
            messageHash: input.messageHash,
          },
        });
      }
      if (actionSpecific) {
        await transaction.insert(commerceAgreementEvents).values({
          agreementId: agreement.id,
          fromStatus: agreement.status,
          toStatus: agreement.status,
          eventType: "EXACT_EXECUTION_AUTHORIZED",
          actorPrincipalId: input.principalId,
          evidence: {
            authorizationId: artifact.id,
            executionRequestId: execution!.id,
            actionHash: input.authorization.actionHash,
            messageHash: input.messageHash,
          },
        });
        await transaction.insert(commerceArtifacts).values({
          agreementId: agreement.id,
          executionRequestId: execution!.id,
          artifactType: "AUTHORIZATION",
          source: "eip712-exact-execution-signature",
          contentHash: input.messageHash,
          safeContent: {
            authorizationId: artifact.id,
            signerAddress: input.signerAddress,
            actionHash: input.authorization.actionHash,
            expiresAt: expiresAt.toISOString(),
          },
          provenance: "independently_observed",
        });
        return artifact.id;
      }
      const changed = await transaction
        .update(commerceAgreements)
        .set({
          authorizationArtifactId: artifact.id,
          status: "AUTHORIZED",
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(commerceAgreements.id, agreement.id),
            eq(commerceAgreements.status, "AUTHORIZATION_REQUIRED"),
          ),
        )
        .returning({ id: commerceAgreements.id });
      if (changed.length !== 1) throw new Error("Agreement state changed");
      await transaction.insert(commerceAgreementEvents).values({
        agreementId: agreement.id,
        fromStatus: "AUTHORIZATION_REQUIRED",
        toStatus: "AUTHORIZED",
        eventType: "WALLET_AUTHORIZATION_VERIFIED",
        actorPrincipalId: input.principalId,
        evidence: {
          authorizationId: artifact.id,
          messageHash: input.messageHash,
          signerAddress: input.signerAddress,
        },
      });
      await transaction.insert(commerceArtifacts).values({
        agreementId: agreement.id,
        artifactType: "AUTHORIZATION",
        source: "eip712-wallet-signature",
        contentHash: input.messageHash,
        safeContent: {
          authorizationId: artifact.id,
          signerAddress: input.signerAddress,
          expiresAt: expiresAt.toISOString(),
        },
        provenance: "independently_observed",
      });
      return artifact.id;
    });
    return {
      artifactId,
      agreement: await this.findAgreement(agreement.id, input.principalId),
    };
  }

  public async createAuthorizationChallenge(input: {
    agreementId: string;
    principalId: string;
    nonceHash: string;
    normalizedPayload: CommerceAuthorization;
    expiresAt: Date;
  }) {
    const agreement = await this.#agreementRow(
      input.agreementId,
      input.principalId,
    );
    const actionSpecific = input.normalizedPayload.actionHash !== null;
    if (
      agreement === null ||
      (actionSpecific
        ? !["AUTHORIZED", "ACTIVE"].includes(agreement.status)
        : agreement.status !== "AUTHORIZATION_REQUIRED")
    )
      throw new Error("Agreement is not awaiting this authorization type");
    if (
      agreement.termsHash !== input.normalizedPayload.termsHash ||
      agreement.chainId !== input.normalizedPayload.chainId ||
      agreement.amountBaseUnits !== input.normalizedPayload.amountBaseUnits ||
      agreement.paymentTokenAddress.toLowerCase() !==
        input.normalizedPayload.tokenAddress.toLowerCase()
    )
      throw new Error("Authorization challenge does not match the agreement");
    const [row] = await this.database
      .insert(authorizationChallenges)
      .values(input)
      .returning();
    if (row === undefined)
      throw new Error("Authorization challenge insert failed");
    return row;
  }

  public async consumeAuthorizationChallenge(input: {
    id: string;
    principalId: string;
    nonceHash: string;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const [row] = await this.database
      .update(authorizationChallenges)
      .set({ consumedAt: now })
      .where(
        and(
          eq(authorizationChallenges.id, input.id),
          eq(authorizationChallenges.principalId, input.principalId),
          eq(authorizationChallenges.nonceHash, input.nonceHash),
          isNull(authorizationChallenges.consumedAt),
          gt(authorizationChallenges.expiresAt, now),
        ),
      )
      .returning();
    return row ?? null;
  }

  public async authorizationChallenge(id: string, principalId: string) {
    const [row] = await this.database
      .select()
      .from(authorizationChallenges)
      .where(
        and(
          eq(authorizationChallenges.id, id),
          eq(authorizationChallenges.principalId, principalId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  public async findAgreement(id: string, principalId: string) {
    const row = await this.#agreementRow(id, principalId);
    if (row === null) return null;
    const [events, operations, movements, settlements, artifacts] =
      await Promise.all([
        this.database
          .select()
          .from(commerceAgreementEvents)
          .where(eq(commerceAgreementEvents.agreementId, id))
          .orderBy(asc(commerceAgreementEvents.occurredAt)),
        this.database
          .select()
          .from(commerceOperations)
          .where(eq(commerceOperations.agreementId, id))
          .orderBy(asc(commerceOperations.createdAt)),
        this.database
          .select()
          .from(commerceValueMovements)
          .where(eq(commerceValueMovements.agreementId, id))
          .orderBy(asc(commerceValueMovements.observedAt)),
        this.database
          .select()
          .from(settlementRecords)
          .where(eq(settlementRecords.agreementId, id)),
        this.database
          .select()
          .from(commerceArtifacts)
          .where(eq(commerceArtifacts.agreementId, id))
          .orderBy(asc(commerceArtifacts.observedAt)),
      ]);
    return { ...row, events, operations, movements, settlements, artifacts };
  }

  public async listAgreements(principalId: string) {
    const rows = await this.database
      .select({ id: commerceAgreements.id })
      .from(commerceAgreements)
      .where(eq(commerceAgreements.principalId, principalId))
      .orderBy(desc(commerceAgreements.updatedAt));
    return Promise.all(
      rows.map((row) => this.findAgreement(row.id, principalId)),
    );
  }

  public async cancelAgreement(input: {
    agreementId: string;
    principalId: string;
  }) {
    const agreement = await this.#agreementRow(
      input.agreementId,
      input.principalId,
    );
    if (agreement === null) throw new Error("Agreement not found");
    assertAgreementTransition(agreement.status, "CANCELLED");
    const [activation] = await this.database
      .select({ lifecycleState: activations.lifecycleState })
      .from(activations)
      .where(eq(activations.commerceAgreementId, agreement.id))
      .limit(1);
    if (
      activation !== undefined &&
      ![
        "PREPARING",
        "NEGOTIATING",
        "AWAITING_AUTHORIZATION",
        "FAILED",
        "BLOCKED",
      ].includes(activation.lifecycleState)
    )
      throw new Error(
        "An onchain commerce job cannot be cancelled without a durable CANCEL operation",
      );
    await this.database.transaction(async (transaction) => {
      const changed = await transaction
        .update(commerceAgreements)
        .set({ status: "CANCELLED", updatedAt: new Date() })
        .where(
          and(
            eq(commerceAgreements.id, agreement.id),
            eq(commerceAgreements.status, agreement.status),
          ),
        )
        .returning({ id: commerceAgreements.id });
      if (changed.length !== 1)
        throw new Error("Agreement changed concurrently");
      await transaction.insert(commerceAgreementEvents).values({
        agreementId: agreement.id,
        fromStatus: agreement.status,
        toStatus: "CANCELLED",
        eventType: "AGREEMENT_CANCELLED",
        actorPrincipalId: input.principalId,
        evidence: { onchainCancellationRequired: false },
      });
    });
    return this.findAgreement(agreement.id, input.principalId);
  }

  public async revokeAuthorization(input: {
    agreementId: string;
    principalId: string;
  }) {
    const agreement = await this.#agreementRow(
      input.agreementId,
      input.principalId,
    );
    if (agreement?.authorizationArtifactId === null || agreement === null)
      throw new Error("No agreement authorization exists");
    await this.database.transaction(async (transaction) => {
      const [artifact] = await transaction
        .update(authorizationArtifacts)
        .set({
          verificationStatus: "REVOKED",
          revokedAt: new Date(),
        })
        .where(
          and(
            eq(authorizationArtifacts.id, agreement.authorizationArtifactId!),
            eq(authorizationArtifacts.principalId, input.principalId),
            eq(authorizationArtifacts.verificationStatus, "VERIFIED"),
          ),
        )
        .returning({ id: authorizationArtifacts.id });
      if (artifact === undefined)
        throw new Error("Authorization already revoked");
      await transaction.insert(authorizationEvents).values({
        authorizationId: artifact.id,
        eventType: "AUTHORIZATION_REVOKED",
        verificationStatus: "REVOKED",
        evidence: { principalInitiated: true },
      });
      if (agreement.status === "AUTHORIZED" || agreement.status === "ACTIVE") {
        await transaction
          .update(commerceAgreements)
          .set({ status: "SUSPENDED", updatedAt: new Date() })
          .where(eq(commerceAgreements.id, agreement.id));
        await transaction.insert(commerceAgreementEvents).values({
          agreementId: agreement.id,
          fromStatus: agreement.status,
          toStatus: "SUSPENDED",
          eventType: "AUTHORIZATION_REVOKED",
          actorPrincipalId: input.principalId,
          evidence: { authorizationId: artifact.id },
        });
      }
    });
    return this.findAgreement(agreement.id, input.principalId);
  }

  public async createOperation(input: {
    agreementId: string;
    activationId?: string;
    executionRequestId?: string;
    operationType: CommerceOperationType;
    idempotencyKey: string;
    state: CommerceOperationState;
    preparedPayloadHash?: string;
    evidence?: Record<string, unknown>;
  }) {
    const [row] = await this.database
      .insert(commerceOperations)
      .values({
        ...input,
        attempt: 1,
        nextAttemptAt: new Date(),
        evidence: input.evidence ?? {},
      })
      .onConflictDoNothing({
        target: [
          commerceOperations.agreementId,
          commerceOperations.idempotencyKey,
        ],
      })
      .returning();
    if (row !== undefined) return row;
    const [existing] = await this.database
      .select()
      .from(commerceOperations)
      .where(
        and(
          eq(commerceOperations.agreementId, input.agreementId),
          eq(commerceOperations.idempotencyKey, input.idempotencyKey),
        ),
      )
      .limit(1);
    if (existing === undefined) throw new Error("Operation insert failed");
    return existing;
  }

  public async createUserCommerceActivation(input: {
    agreementId: string;
    executionRequestId: string;
    authorizationId: string;
    commerceAddress: string;
    clientAddress: string;
    evaluatorAddress: string;
  }) {
    const agreement = await this.#agreementRowById(input.agreementId);
    if (
      agreement === null ||
      agreement.status !== "AUTHORIZED" ||
      agreement.authorizationArtifactId !== input.authorizationId ||
      agreement.mandateId === null ||
      agreement.mandateVersion === null
    )
      throw new Error("A fully authorized agreement is required");
    const [execution] = await this.database
      .select()
      .from(executionRequests)
      .where(
        and(
          eq(executionRequests.id, input.executionRequestId),
          eq(executionRequests.principalId, agreement.principalId),
          eq(executionRequests.mandateId, agreement.mandateId),
          eq(executionRequests.mandateVersion, agreement.mandateVersion),
          eq(executionRequests.agentId, agreement.agentId),
          inArray(executionRequests.status, ["APPROVED", "SUCCEEDED"]),
        ),
      )
      .limit(1);
    if (execution === undefined)
      throw new Error("A matching policy-approved execution is required");
    const [[mandate], [authorization], [identity]] = await Promise.all([
      this.database
        .select({ principalType: mandates.principalType })
        .from(mandates)
        .where(eq(mandates.id, agreement.mandateId))
        .limit(1),
      this.database
        .select({
          type: authorizationArtifacts.authorizationType,
          status: authorizationArtifacts.verificationStatus,
          signerAddress: authorizationArtifacts.signerAddress,
          expiresAt: authorizationArtifacts.expiresAt,
          revokedAt: authorizationArtifacts.revokedAt,
        })
        .from(authorizationArtifacts)
        .where(eq(authorizationArtifacts.id, input.authorizationId))
        .limit(1),
      this.database
        .select({ ownerAddress: agentIdentities.ownerAddress })
        .from(agentIdentities)
        .where(eq(agentIdentities.agentId, agreement.agentId))
        .limit(1),
    ]);
    if (mandate?.principalType !== "WALLET")
      throw new Error(
        "Development principals cannot create user commerce jobs",
      );
    if (
      authorization?.type !== "WALLET_SIGNATURE" ||
      authorization.status !== "VERIFIED" ||
      authorization.signerAddress === null ||
      authorization.revokedAt !== null ||
      authorization.expiresAt <= new Date() ||
      authorization.signerAddress.toLowerCase() !==
        input.clientAddress.toLowerCase()
    )
      throw new Error(
        "A current wallet authorization from the buyer is required",
      );
    if (identity === undefined)
      throw new Error("The current ERC-8004 provider owner is unavailable");
    if (
      identity.ownerAddress.toLowerCase() === input.clientAddress.toLowerCase()
    )
      throw new Error("The seller wallet must never represent the buyer");
    return this.database.transaction(async (transaction) => {
      const [activatedAgreement] = await transaction
        .update(commerceAgreements)
        .set({ status: "ACTIVE", updatedAt: new Date() })
        .where(
          and(
            eq(commerceAgreements.id, agreement.id),
            eq(commerceAgreements.status, "AUTHORIZED"),
            eq(
              commerceAgreements.authorizationArtifactId,
              input.authorizationId,
            ),
          ),
        )
        .returning({ id: commerceAgreements.id });
      if (activatedAgreement === undefined)
        throw new Error("Agreement changed before activation could be created");
      const [row] = await transaction
        .insert(activations)
        .values({
          agentId: agreement.agentId,
          serviceId: agreement.serviceId,
          chainId: agreement.chainId,
          purpose: "USER_COMMERCE",
          commerceAgreementId: agreement.id,
          executionRequestId: execution.id,
          mandateId: agreement.mandateId,
          mandateVersion: agreement.mandateVersion,
          principalId: agreement.principalId,
          acceptedTermsHash: agreement.termsHash,
          pricingSnapshot: agreement.pricingSnapshot,
          budgetBaseUnits: agreement.amountBaseUnits,
          paymentTokenDecimals: agreement.paymentTokenDecimals,
          authorizationId: input.authorizationId,
          commerceAddress: input.commerceAddress,
          clientAddress: input.clientAddress,
          providerAddress: identity.ownerAddress,
          evaluatorAddress: input.evaluatorAddress,
          currencyToken: agreement.paymentTokenAddress,
          lifecycleState: "PREPARING",
          status: "PREPARED",
        })
        .returning();
      if (row === undefined)
        throw new Error("Commerce activation insert failed");
      await transaction.insert(commerceAgreementEvents).values({
        agreementId: agreement.id,
        fromStatus: "AUTHORIZED",
        toStatus: "ACTIVE",
        eventType: "COMMERCE_ACTIVATION_CREATED",
        actorPrincipalId: agreement.principalId,
        evidence: { activationId: row.id, executionRequestId: execution.id },
      });
      await transaction.insert(commerceOperations).values({
        agreementId: agreement.id,
        activationId: row.id,
        executionRequestId: execution.id,
        operationType: "PREPARE_JOB",
        state: "CREATED",
        idempotencyKey: `activation:${row.id}:prepare-job`,
        attempt: 1,
        evidence: {
          userCommerce: true,
          transactionPrepared: false,
          transactionSubmitted: false,
        },
      });
      return row;
    });
  }

  public async transitionCommerceActivation(input: {
    activationId: string;
    from: ActivationLifecycleState;
    to: ActivationLifecycleState;
    evidence: Record<string, unknown>;
    transactionHash?: string | null;
    blockNumber?: bigint | null;
    externalJobId?: string | null;
    resultReference?: string | null;
    reconciliationState?:
      "PENDING" | "CURRENT" | "STALE" | "REORGED" | "FAILED";
  }) {
    assertActivationLifecycleTransition(input.from, input.to);
    const legacyStatus = legacyActivationStatusForLifecycle(input.to);
    return this.database.transaction(async (transaction) => {
      const [changed] = await transaction
        .update(activations)
        .set({
          lifecycleState: input.to,
          status: legacyStatus,
          externalJobId: input.externalJobId,
          resultReference: input.resultReference,
          reconciliationState: input.reconciliationState,
          updatedAt: new Date(),
        })
        .where(
          and(
            eq(activations.id, input.activationId),
            eq(activations.purpose, "USER_COMMERCE"),
            eq(activations.lifecycleState, input.from),
          ),
        )
        .returning();
      if (changed === undefined)
        throw new Error("Commerce activation state changed concurrently");
      await transaction.insert(commerceAgreementEvents).values({
        agreementId: changed.commerceAgreementId!,
        fromStatus: null,
        toStatus:
          input.to === "COMPLETED"
            ? "COMPLETED"
            : input.to === "FAILED"
              ? "FAILED"
              : "ACTIVE",
        eventType: `ERC8183_${input.to}`,
        actorPrincipalId: changed.principalId!,
        evidence: input.evidence,
      });
      if (input.to === "COMPLETED" || input.to === "FAILED") {
        await transaction
          .update(commerceAgreements)
          .set({ status: input.to, updatedAt: new Date() })
          .where(eq(commerceAgreements.id, changed.commerceAgreementId!));
      }
      await transaction.insert(activationLifecycleTransitions).values({
        activationId: changed.id,
        fromState: input.from,
        toState: input.to,
        evidence: input.evidence,
        transactionHash: input.transactionHash,
        blockNumber: input.blockNumber,
      });
      await transaction.insert(activationTransitions).values({
        activationId: changed.id,
        status: legacyStatus,
        transactionHash: input.transactionHash,
        blockNumber: input.blockNumber,
        evidence: {
          compatibilityProjection: true,
          canonicalLifecycleState: input.to,
        },
      });
      await transaction.insert(commerceArtifacts).values({
        agreementId: changed.commerceAgreementId!,
        activationId: changed.id,
        executionRequestId: changed.executionRequestId,
        artifactType:
          input.to === "DELIVERED"
            ? "DELIVERY"
            : input.to === "COMPLETED"
              ? "SETTLEMENT"
              : input.to === "REJECTED"
                ? "REJECTION"
                : input.to === "REFUNDED"
                  ? "REFUND"
                  : "JOB_SPECIFICATION",
        source: "erc8183-lifecycle-reconciliation",
        contentHash: immutableContentHash({
          activationId: changed.id,
          state: input.to,
          evidence: input.evidence,
          transactionHash: input.transactionHash ?? null,
          blockNumber: input.blockNumber?.toString() ?? null,
        }),
        safeContent: {
          state: input.to,
          transactionHash: input.transactionHash ?? null,
          blockNumber: input.blockNumber?.toString() ?? null,
        },
        provenance:
          input.transactionHash === undefined || input.transactionHash === null
            ? "independently_observed"
            : "onchain_verified",
      });
      return changed;
    });
  }

  public async leaseOperations(input: {
    workerId: string;
    limit: number;
    leaseSeconds: number;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const leaseExpiresAt = new Date(now.getTime() + input.leaseSeconds * 1_000);
    const result = await this.database.execute(sql`
      with candidates as (
        select id from commerce_operations
        where state in ('READY', 'SUBMITTED', 'PENDING', 'REORGED')
          and (next_attempt_at is null or next_attempt_at <= ${now})
          and (lease_expires_at is null or lease_expires_at <= ${now})
        order by coalesce(next_attempt_at, created_at), created_at
        for update skip locked
        limit ${input.limit}
      )
      update commerce_operations o
      set lease_owner = ${input.workerId}, lease_expires_at = ${leaseExpiresAt},
          updated_at = ${now}
      from candidates c
      where o.id = c.id
      returning o.*
    `);
    const rows = (
      result as unknown as { rows?: Array<Record<string, unknown>> }
    ).rows;
    return rows ?? Array.from(result);
  }

  public async transitionOperation(input: {
    id: string;
    workerId: string;
    from: CommerceOperationState[];
    to: CommerceOperationState;
    transactionHash?: string | null;
    blockNumber?: bigint | null;
    blockHash?: string | null;
    confirmationCount?: number;
    finalityState?: "UNCONFIRMED" | "CONFIRMED" | "FINALIZED" | "REORGED";
    failure?: Record<string, unknown> | null;
    evidence?: Record<string, unknown>;
    nextAttemptAt?: Date | null;
    incrementRetry?: boolean;
  }) {
    const [row] = await this.database
      .update(commerceOperations)
      .set({
        state: input.to,
        transactionHash: input.transactionHash,
        blockNumber: input.blockNumber,
        blockHash: input.blockHash,
        confirmationCount: input.confirmationCount,
        finalityState: input.finalityState,
        failure: input.failure,
        evidence: input.evidence,
        nextAttemptAt: input.nextAttemptAt,
        retryCount: input.incrementRetry
          ? sql`${commerceOperations.retryCount} + 1`
          : undefined,
        leaseOwner: null,
        leaseExpiresAt: null,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(commerceOperations.id, input.id),
          eq(commerceOperations.leaseOwner, input.workerId),
          inArray(commerceOperations.state, input.from),
        ),
      )
      .returning();
    return row ?? null;
  }

  public async recordValueMovement(input: {
    agreementId: string;
    activationId?: string;
    executionRequestId?: string;
    sourceOperationId?: string;
    movementType:
      | "FUNDING"
      | "ESCROW_LOCK"
      | "PAYMENT"
      | "REFUND"
      | "FEE"
      | "ESCROW_RELEASE";
    chainId: number;
    tokenAddress: string;
    tokenDecimals: number;
    amountBaseUnits: string;
    payerAddress?: string;
    payeeAddress?: string;
    transactionHash?: string;
    logIndex?: number;
    blockNumber?: bigint;
    blockHash?: string;
    finalityState: "UNCONFIRMED" | "CONFIRMED" | "FINALIZED" | "REORGED";
    provenance:
      | "onchain_verified"
      | "independently_observed"
      | "agent_reported"
      | "developer_declared"
      | "secondary_unverified";
  }) {
    if (BigInt(input.amountBaseUnits) < 0n)
      throw new Error("Value movements cannot be negative");
    const [row] = await this.database
      .insert(commerceValueMovements)
      .values(input)
      .onConflictDoNothing()
      .returning();
    return row ?? null;
  }

  public async recordFinalSettlement(input: {
    agreementId: string;
    activationId: string;
    executionRequestId?: string;
    status: "SETTLED" | "REJECTED" | "REFUNDED" | "FAILED";
    expectedAmountBaseUnits: string;
    fundedAmountBaseUnits: string;
    settledAmountBaseUnits: string;
    refundedAmountBaseUnits: string;
    feeAmountBaseUnits: string;
    tokenAddress: string;
    tokenDecimals: number;
    evidence: Record<string, unknown>;
  }) {
    for (const value of [
      input.expectedAmountBaseUnits,
      input.fundedAmountBaseUnits,
      input.settledAmountBaseUnits,
      input.refundedAmountBaseUnits,
      input.feeAmountBaseUnits,
    ])
      if (!/^\d+$/.test(value))
        throw new Error("Settlement amounts must be base-unit integers");
    if (input.status === "SETTLED") {
      const required = await this.database
        .select({ type: commerceArtifacts.artifactType })
        .from(commerceArtifacts)
        .where(
          and(
            eq(commerceArtifacts.agreementId, input.agreementId),
            inArray(commerceArtifacts.artifactType, ["DELIVERY", "EVALUATION"]),
          ),
        );
      const types = new Set(required.map(({ type }) => type));
      if (!types.has("DELIVERY") || !types.has("EVALUATION"))
        throw new Error(
          "Settlement requires durable delivery and evaluation evidence",
        );
    }
    const [row] = await this.database
      .insert(settlementRecords)
      .values({ ...input, finalizedAt: new Date() })
      .onConflictDoNothing()
      .returning();
    return row ?? null;
  }

  public async recordReputationObservation(input: {
    agentId: string;
    agreementId?: string;
    activationId?: string;
    kind: string;
    value: Record<string, unknown>;
    provenance:
      | "onchain_verified"
      | "independently_observed"
      | "agent_reported"
      | "developer_declared"
      | "secondary_unverified";
    evidenceReference: Record<string, unknown>;
    observedAt: Date;
  }) {
    if (input.agreementId === undefined || input.activationId === undefined)
      throw new Error(
        "User-commerce reputation requires agreement and activation evidence",
      );
    const [activation] = await this.database
      .select({ purpose: activations.purpose })
      .from(activations)
      .where(
        and(
          eq(activations.id, input.activationId),
          eq(activations.commerceAgreementId, input.agreementId),
        ),
      )
      .limit(1);
    if (activation?.purpose !== "USER_COMMERCE")
      throw new Error(
        "Verification activations cannot become commerce reputation",
      );
    const [row] = await this.database
      .insert(commerceReputationObservations)
      .values(input)
      .returning();
    return row;
  }

  async #eligibleOperatorService(
    agentId: string,
    serviceId: string,
    operatorAddress: string,
    chainId: number,
  ) {
    const freshness = new Date(Date.now() - 604_800_000);
    const [row] = await this.database
      .select({
        ownerAddress: agentIdentities.ownerAddress,
        verificationLevel: marketplaceServices.verificationLevel,
        lastVerifiedAt: marketplaceServices.lastVerifiedAt,
      })
      .from(marketplaceServices)
      .innerJoin(
        agentIdentities,
        eq(agentIdentities.agentId, marketplaceServices.agentId),
      )
      .innerJoin(
        launchCandidates,
        eq(launchCandidates.agentId, marketplaceServices.agentId),
      )
      .where(
        and(
          eq(marketplaceServices.id, serviceId),
          eq(marketplaceServices.agentId, agentId),
          sql`coalesce(${marketplaceServices.networkChainId}, ${agentIdentities.chainId}) = ${chainId}`,
          eq(marketplaceServices.availability, "available"),
          inArray(marketplaceServices.verificationLevel, [
            "INVOCATION_VERIFIED",
            "COMMERCE_VERIFIED",
          ]),
          gt(marketplaceServices.lastVerifiedAt, freshness),
          eq(launchCandidates.status, "ACTIONABLE"),
          sql`lower(${agentIdentities.ownerAddress}) = lower(${operatorAddress})`,
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async #transitionOffer(
    id: string,
    from: OfferStatus,
    to: OfferStatus,
    principalId: string,
    evidence: Record<string, unknown>,
  ) {
    await this.database.transaction(async (transaction) => {
      const changed = await transaction
        .update(agentOffers)
        .set({ status: to, updatedAt: new Date() })
        .where(and(eq(agentOffers.id, id), eq(agentOffers.status, from)))
        .returning({ id: agentOffers.id });
      if (changed.length !== 1) throw new Error("Offer state changed");
      await transaction.insert(agentOfferEvents).values({
        offerId: id,
        eventType: `OFFER_${to}`,
        actorPrincipalId: principalId,
        evidence,
      });
    });
  }

  #offer(
    offer: typeof agentOffers.$inferSelect,
    version: typeof agentOfferVersions.$inferSelect,
  ) {
    return {
      id: offer.id,
      operatorPrincipalId: offer.operatorPrincipalId,
      agentId: offer.agentId,
      serviceId: offer.serviceId,
      status: offer.status,
      currentVersion: offer.currentVersion,
      version: {
        id: version.id,
        offerId: version.offerId,
        version: version.version,
        agentId: offer.agentId,
        serviceId: offer.serviceId,
        chainId: version.chainId as 56 | 97,
        capability: version.capability,
        billingModel: version.billingModel,
        price: {
          chainId: version.chainId,
          tokenAddress: version.paymentTokenAddress as `0x${string}`,
          decimals: version.paymentTokenDecimals,
          amountBaseUnits: version.priceBaseUnits,
          symbol: version.currencySymbol,
        },
        terms: version.termsContent,
        termsHash: version.termsHash as `0x${string}`,
        capabilitySnapshot: strings(version.capabilitySnapshot),
        limitationsSnapshot: strings(version.limitationsSnapshot),
        evidenceReference: asObject(version.evidenceReference),
        effectiveAt: version.effectiveAt.toISOString(),
        expiresAt: version.expiresAt?.toISOString() ?? null,
        createdAt: version.createdAt.toISOString(),
      },
      createdAt: offer.createdAt.toISOString(),
      updatedAt: offer.updatedAt.toISOString(),
    };
  }

  async #agreementRow(id: string, principalId: string) {
    const [row] = await this.database
      .select()
      .from(commerceAgreements)
      .where(
        and(
          eq(commerceAgreements.id, id),
          eq(commerceAgreements.principalId, principalId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async #agreementRowById(id: string) {
    const [row] = await this.database
      .select()
      .from(commerceAgreements)
      .where(eq(commerceAgreements.id, id))
      .limit(1);
    return row ?? null;
  }
}
