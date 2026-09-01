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
import { and, asc, desc, eq, gt, inArray, isNull, notExists, or, sql } from "drizzle-orm";

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
  commerceValidationSessions,
  commerceReputationObservations,
  commerceValueMovements,
  executionRequests,
  executionApprovals,
  launchCandidates,
  mandates,
  mandateEvidenceBindings,
  mandateEvents,
  mandateVersions,
  marketplaceServices,
  marketplaceOutcomes,
  marketplaceReviews,
  sellerAgentAuthorizations,
  settlementRecords,
  walletAuthChallenges,
  walletSessions,
} from "./schema.js";

const COMMERCE_VALIDATION_RELATIONSHIP_LIFETIME_MS = 30 * 86_400_000;

const asObject = (value: unknown) => (value ?? {}) as Record<string, unknown>;
const strings = (value: unknown) =>
  Array.isArray(value) ? value.map(String) : [];

export interface PreparedSetupOperation {
  operationType:
    "CREATE_JOB" | "REGISTER_JOB" | "SET_BUDGET" | "APPROVE_TOKEN" | "FUND";
  idempotencyKey: string;
  state: "AWAITING_SIGNATURE" | "CANCELLED";
  preparedPayloadHash: string;
  evidence: Record<string, unknown>;
  failure?: Record<string, unknown>;
}

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

  public async marketplaceReviewEligibility(input: {
    activationId: string;
    principalId: string;
    walletAddress: string;
    reviewerRole: "BUYER" | "AGENT";
  }) {
    const [record] = await this.database
      .select({
        activationId: activations.id,
        agreementId: activations.commerceAgreementId,
        agentId: activations.agentId,
        purpose: activations.purpose,
        marketplaceHistoryEligible: activations.marketplaceHistoryEligible,
        lifecycleState: activations.lifecycleState,
        status: activations.status,
        buyerPrincipalId: activations.principalId,
        providerAddress: activations.providerAddress,
        operatorPrincipalId: agentOffers.operatorPrincipalId,
        commerceSuccessful: marketplaceOutcomes.commerceSuccessful,
        acceptedResponsibility: sql<boolean>`exists (
          select 1 from ${commerceOperations} review_fund
          where review_fund.activation_id = ${activations.id}
            and review_fund.operation_type = 'FUND'
            and review_fund.state = 'FINALIZED'
        )`,
      })
      .from(activations)
      .leftJoin(
        commerceAgreements,
        eq(commerceAgreements.id, activations.commerceAgreementId),
      )
      .leftJoin(agentOffers, eq(agentOffers.id, commerceAgreements.offerId))
      .leftJoin(
        marketplaceOutcomes,
        eq(marketplaceOutcomes.activationId, activations.id),
      )
      .where(eq(activations.id, input.activationId))
      .limit(1);
    if (record === undefined)
      return { eligible: false as const, reason: "job_not_found" };
    if (
      record.purpose !== "USER_COMMERCE" ||
      !record.marketplaceHistoryEligible
    )
      return { eligible: false as const, reason: "not_marketplace_work" };
    if (
      record.lifecycleState !== "COMPLETED" ||
      record.status !== "COMPLETED" ||
      record.commerceSuccessful !== true ||
      !record.acceptedResponsibility
    )
      return { eligible: false as const, reason: "job_not_completed" };
    if (record.agreementId === null)
      return { eligible: false as const, reason: "agreement_missing" };
    const isBuyer = record.buyerPrincipalId === input.principalId;
    const isAgent =
      record.operatorPrincipalId === input.principalId &&
      record.providerAddress?.toLowerCase() ===
        input.walletAddress.toLowerCase();
    if (
      (input.reviewerRole === "BUYER" && !isBuyer) ||
      (input.reviewerRole === "AGENT" && !isAgent)
    )
      return { eligible: false as const, reason: "reviewer_not_a_party" };
    const subjectType: "AGENT" | "BUYER" =
      input.reviewerRole === "BUYER" ? "AGENT" : "BUYER";
    const [existingReview] = await this.database
      .select({ id: marketplaceReviews.id })
      .from(marketplaceReviews)
      .where(
        and(
          eq(marketplaceReviews.activationId, input.activationId),
          eq(marketplaceReviews.reviewerRole, input.reviewerRole),
          eq(marketplaceReviews.subjectType, subjectType),
        ),
      )
      .limit(1);
    return {
      eligible: existingReview === undefined,
      reason:
        existingReview === undefined
          ? ("eligible" as const)
          : ("already_reviewed" as const),
      reviewerRole: input.reviewerRole,
      subjectType,
      activationId: record.activationId,
      agreementId: record.agreementId,
      agentId: record.agentId,
      buyerPrincipalId: record.buyerPrincipalId!,
      existingReviewId: existingReview?.id ?? null,
    };
  }

  public async createMarketplaceReview(input: {
    activationId: string;
    agreementId: string;
    reviewerPrincipalId: string;
    reviewerRole: "BUYER" | "AGENT";
    subjectType: "AGENT" | "BUYER";
    subjectAgentId: string | null;
    subjectPrincipalId: string | null;
    sentiment: "GOOD" | "BAD";
    tags: string[];
    message: string | null;
    eligibilityProvenance: Record<string, unknown>;
  }) {
    const [review] = await this.database
      .insert(marketplaceReviews)
      .values({
        activationId: input.activationId,
        commerceAgreementId: input.agreementId,
        reviewerPrincipalId: input.reviewerPrincipalId,
        reviewerRole: input.reviewerRole,
        subjectType: input.subjectType,
        subjectAgentId: input.subjectAgentId,
        subjectPrincipalId: input.subjectPrincipalId,
        sentiment: input.sentiment,
        tags: input.tags,
        message: input.message,
        eligibilityProvenance: input.eligibilityProvenance,
        marketplaceHistoryEligible: true,
      })
      .onConflictDoNothing()
      .returning();
    if (review === undefined)
      throw new Error(
        "This marketplace job has already been reviewed by this party",
      );
    return {
      id: review.id,
      activationId: review.activationId,
      reviewerRole: review.reviewerRole,
      subjectType: review.subjectType,
      sentiment: review.sentiment,
      tags: review.tags,
      message: review.message,
      createdAt: review.createdAt.toISOString(),
    };
  }

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
    const [existingOffer] = await this.database
      .select({ id: agentOffers.id })
      .from(agentOffers)
      .where(
        and(
          eq(agentOffers.operatorPrincipalId, input.operatorPrincipalId),
          eq(agentOffers.agentId, request.agentId),
          eq(agentOffers.serviceId, request.serviceId),
          inArray(agentOffers.status, ["DRAFT", "ACTIVE", "PAUSED"]),
        ),
      )
      .limit(1);
    if (existingOffer !== undefined)
      throw new Error(
        "A current offer already exists for this agent service; revise or discard it instead",
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
          eq(marketplaceServices.listingIsHireable, true),
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
          or(
            notExists(
              this.database
                .select({ id: sellerAgentAuthorizations.id })
                .from(sellerAgentAuthorizations)
                .where(
                  and(
                    eq(sellerAgentAuthorizations.agentId, agentOffers.agentId),
                    isNull(sellerAgentAuthorizations.revokedAt),
                  ),
                ),
            ),
            this.database
              .select({ id: sellerAgentAuthorizations.id })
              .from(sellerAgentAuthorizations)
              .where(
                and(
                  eq(sellerAgentAuthorizations.agentId, agentOffers.agentId),
                  eq(
                    sellerAgentAuthorizations.principalId,
                    agentOffers.operatorPrincipalId,
                  ),
                  isNull(sellerAgentAuthorizations.revokedAt),
                ),
              ),
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

  public async createCommerceValidationSession(input: {
    offerId: string;
    sellerPrincipalId: string;
    handoffTokenHash: string;
    expiresAt: Date;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const offer = await this.findOffer(input.offerId);
    if (
      offer === null ||
      offer.status !== "ACTIVE" ||
      offer.operatorPrincipalId !== input.sellerPrincipalId ||
      (offer.version.expiresAt !== null &&
        new Date(offer.version.expiresAt) <= now)
    )
      throw new Error(
        "A current active offer owned by this seller is required for validation",
      );
    return this.database.transaction(async (transaction) => {
      await transaction
        .update(commerceValidationSessions)
        .set({ status: "CANCELLED", updatedAt: now })
        .where(
          and(
            eq(commerceValidationSessions.offerId, offer.id),
            eq(
              commerceValidationSessions.sellerPrincipalId,
              input.sellerPrincipalId,
            ),
            inArray(commerceValidationSessions.status, ["OPEN", "CLAIMED"]),
          ),
        );
      const [session] = await transaction
        .insert(commerceValidationSessions)
        .values({
          offerId: offer.id,
          offerVersionId: offer.version.id,
          agentId: offer.agentId,
          serviceId: offer.serviceId,
          chainId: offer.version.chainId,
          sellerPrincipalId: input.sellerPrincipalId,
          handoffTokenHash: input.handoffTokenHash,
          expiresAt: input.expiresAt,
          status: "OPEN",
        })
        .returning();
      if (session === undefined)
        throw new Error("Commerce validation session insert failed");
      await transaction.insert(agentOfferEvents).values({
        offerId: offer.id,
        offerVersionId: offer.version.id,
        eventType: "COMMERCE_VALIDATION_SESSION_CREATED",
        actorPrincipalId: input.sellerPrincipalId,
        evidence: {
          validationSessionId: session.id,
          expiresAt: input.expiresAt.toISOString(),
          offerVersion: offer.currentVersion,
          transactionSubmitted: false,
        },
      });
      return { session, offer };
    });
  }

  public async commerceValidationSession(input: {
    sessionId: string;
    handoffTokenHash: string;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const [row] = await this.database
      .select({ session: commerceValidationSessions })
      .from(commerceValidationSessions)
      .where(
        and(
          eq(commerceValidationSessions.id, input.sessionId),
          eq(
            commerceValidationSessions.handoffTokenHash,
            input.handoffTokenHash,
          ),
        ),
      )
      .limit(1);
    if (row === undefined) return null;
    if (row.session.status === "OPEN" && row.session.expiresAt <= now) {
      const [expired] = await this.database
        .update(commerceValidationSessions)
        .set({ status: "EXPIRED", updatedAt: now })
        .where(
          and(
            eq(commerceValidationSessions.id, row.session.id),
            eq(commerceValidationSessions.status, "OPEN"),
          ),
        )
        .returning();
      return expired ?? { ...row.session, status: "EXPIRED" as const };
    }
    return row.session;
  }

  public async claimCommerceValidationSession(input: {
    sessionId: string;
    handoffTokenHash: string;
    buyerPrincipalId: string;
    buyerAddress: string;
    chainId: number;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select({
          session: commerceValidationSessions,
          ownerAddress: agentIdentities.ownerAddress,
        })
        .from(commerceValidationSessions)
        .innerJoin(
          agentIdentities,
          eq(agentIdentities.agentId, commerceValidationSessions.agentId),
        )
        .where(
          and(
            eq(commerceValidationSessions.id, input.sessionId),
            eq(
              commerceValidationSessions.handoffTokenHash,
              input.handoffTokenHash,
            ),
          ),
        )
        .limit(1);
      if (row === undefined) throw new Error("Validation handoff is invalid");
      if (
        row.session.status === "CLAIMED" &&
        row.session.buyerPrincipalId === input.buyerPrincipalId &&
        row.session.expiresAt > now &&
        row.session.chainId === input.chainId
      )
        return row.session;
      if (
        row.session.status !== "OPEN" ||
        row.session.expiresAt <= now ||
        row.session.chainId !== input.chainId
      )
        throw new Error("Validation handoff is no longer claimable");
      if (row.ownerAddress.toLowerCase() === input.buyerAddress.toLowerCase())
        throw new Error(
          "The registered seller wallet cannot act as the validation buyer",
        );
      const [claimed] = await transaction
        .update(commerceValidationSessions)
        .set({
          status: "CLAIMED",
          buyerPrincipalId: input.buyerPrincipalId,
          updatedAt: now,
        })
        .where(
          and(
            eq(commerceValidationSessions.id, row.session.id),
            eq(commerceValidationSessions.status, "OPEN"),
            gt(commerceValidationSessions.expiresAt, now),
            isNull(commerceValidationSessions.buyerPrincipalId),
          ),
        )
        .returning();
      if (claimed === undefined)
        throw new Error("Validation handoff was claimed by another buyer");
      await transaction.insert(agentOfferEvents).values({
        offerId: claimed.offerId,
        offerVersionId: claimed.offerVersionId,
        eventType: "COMMERCE_VALIDATION_SESSION_CLAIMED",
        actorPrincipalId: input.buyerPrincipalId,
        evidence: {
          validationSessionId: claimed.id,
          buyerAddress: input.buyerAddress,
          transactionSubmitted: false,
        },
      });
      return claimed;
    });
  }

  public async prepareCommerceValidationSession(input: {
    sessionId: string;
    handoffTokenHash: string;
    buyerPrincipalId: string;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    return this.database.transaction(async (transaction) => {
      const [row] = await transaction
        .select({
          session: commerceValidationSessions,
          offer: agentOffers,
          version: agentOfferVersions,
          service: marketplaceServices,
          identity: agentIdentities,
        })
        .from(commerceValidationSessions)
        .innerJoin(
          agentOffers,
          eq(agentOffers.id, commerceValidationSessions.offerId),
        )
        .innerJoin(
          agentOfferVersions,
          eq(agentOfferVersions.id, commerceValidationSessions.offerVersionId),
        )
        .innerJoin(
          marketplaceServices,
          eq(marketplaceServices.id, commerceValidationSessions.serviceId),
        )
        .innerJoin(
          agentIdentities,
          eq(agentIdentities.agentId, commerceValidationSessions.agentId),
        )
        .where(
          and(
            eq(commerceValidationSessions.id, input.sessionId),
            eq(
              commerceValidationSessions.handoffTokenHash,
              input.handoffTokenHash,
            ),
          ),
        )
        .limit(1);
      if (row === undefined) throw new Error("Validation handoff is invalid");
      if (
        row.session.status !== "CLAIMED" ||
        row.session.buyerPrincipalId !== input.buyerPrincipalId ||
        row.session.expiresAt <= now
      )
        throw new Error("Validation handoff is not ready for preparation");
      if (row.session.mandateId !== null || row.session.agreementId !== null) {
        if (row.session.mandateId === null || row.session.agreementId === null)
          throw new Error("Validation preparation is incomplete");
        return row.session;
      }
      const serviceFreshAfter = new Date(now.getTime() - 7 * 86_400_000);
      if (
        row.offer.status !== "ACTIVE" ||
        row.offer.currentVersion !== row.version.version ||
        row.offer.agentId !== row.session.agentId ||
        row.offer.serviceId !== row.session.serviceId ||
        row.version.offerId !== row.offer.id ||
        row.version.chainId !== row.session.chainId ||
        (row.version.expiresAt !== null && row.version.expiresAt <= now) ||
        row.service.agentId !== row.session.agentId ||
        row.service.availability !== "available" ||
        !["INVOCATION_VERIFIED", "COMMERCE_VERIFIED"].includes(
          row.service.verificationLevel,
        ) ||
        row.service.lastVerifiedAt === null ||
        row.service.lastVerifiedAt < serviceFreshAfter ||
        row.service.endpoint === null ||
        row.identity.chainId !== row.session.chainId
      )
        throw new Error(
          "The exact offer and verified service must remain current for validation",
        );

      const capabilitySet = [
        ...new Set([
          row.version.capability,
          ...strings(row.version.capabilitySnapshot),
        ]),
      ];
      const objective =
        `Validate the advertised ${row.version.capability} service under its immutable marketplace offer terms.`.slice(
          0,
          1_000,
        );
      const relationshipExpiresAt = new Date(
        now.getTime() + COMMERCE_VALIDATION_RELATIONSHIP_LIFETIME_MS,
      );
      const boundedRelationshipExpiresAt =
        row.version.expiresAt !== null &&
        row.version.expiresAt < relationshipExpiresAt
          ? row.version.expiresAt
          : relationshipExpiresAt;
      const [mandate] = await transaction
        .insert(mandates)
        .values({
          principalId: input.buyerPrincipalId,
          principalType: "WALLET",
          agentId: row.session.agentId,
          chainId: row.session.chainId,
          status: "ACTIVE",
          authorizationBoundary: "POLICY_ONLY",
          currentVersion: 1,
          activeVersion: 1,
        })
        .returning({ id: mandates.id });
      if (mandate === undefined)
        throw new Error("Validation mandate insert failed");
      const [mandateVersion] = await transaction
        .insert(mandateVersions)
        .values({
          mandateId: mandate.id,
          version: 1,
          state: "ACTIVE",
          serviceId: row.session.serviceId,
          objective,
          allowedCapabilities: capabilitySet,
          deniedCapabilities: [],
          allowedAssets: [],
          allowedProtocols: [],
          allowedContracts: [],
          perActionLimit: null,
          aggregateLimit: null,
          executionFrequency: { maxActions: 1, windowSeconds: 3_600 },
          startAt: now,
          expiresAt: boundedRelationshipExpiresAt,
          approvalMode: "OBSERVE_ONLY",
          riskConstraints: {
            purpose: "COMMERCE_VALIDATION",
            offerId: row.offer.id,
            offerVersionId: row.version.id,
            paymentAuthority: false,
          },
          stopConditions: [
            { type: "VALIDATION_RELATIONSHIP_EXPIRES" },
            { type: "ONE_SUCCESSFUL_EXECUTION" },
          ],
          approvedAt: now,
          activatedAt: now,
        })
        .returning({ id: mandateVersions.id });
      if (mandateVersion === undefined)
        throw new Error("Validation mandate version insert failed");
      await transaction.insert(mandateEvidenceBindings).values({
        mandateVersionId: mandateVersion.id,
        agentId: row.session.agentId,
        externalAgentId: row.identity.externalAgentId,
        registryAddress: row.identity.registryAddress,
        serviceId: row.session.serviceId,
        serviceEndpoint: row.service.endpoint,
        verificationTier: "Actionable",
        verificationTimestamp: row.service.lastVerifiedAt,
        chainId: row.session.chainId,
        capabilitySet,
        evidenceSnapshot: {
          purpose: "COMMERCE_VALIDATION",
          validationSessionId: row.session.id,
          offerId: row.offer.id,
          offerVersionId: row.version.id,
          termsHash: row.version.termsHash,
          serviceVerificationLevel: row.service.verificationLevel,
          serviceSource: row.service.source,
          serviceProvenance: row.service.provenance,
          transactionSubmitted: false,
        },
      });
      await transaction.insert(mandateEvents).values([
        {
          mandateId: mandate.id,
          mandateVersionId: mandateVersion.id,
          eventType: "MANDATE_CREATED",
          securitySensitive: true,
          details: {
            purpose: "COMMERCE_VALIDATION",
            authorizationBoundary: "POLICY_ONLY",
          },
          evidenceReferences: {
            validationSessionId: row.session.id,
            offerVersionId: row.version.id,
          },
          occurredAt: now,
        },
        {
          mandateId: mandate.id,
          mandateVersionId: mandateVersion.id,
          eventType: "MANDATE_REVIEWED",
          securitySensitive: true,
          details: { exactOfferSnapshotVerified: true },
          evidenceReferences: { termsHash: row.version.termsHash },
          occurredAt: now,
        },
        {
          mandateId: mandate.id,
          mandateVersionId: mandateVersion.id,
          eventType: "MANDATE_ACTIVATED",
          securitySensitive: true,
          details: {
            policyActivated: true,
            walletAuthorization: false,
            transactionSubmitted: false,
          },
          evidenceReferences: { validationSessionId: row.session.id },
          occurredAt: now,
        },
      ]);

      const pricingSnapshot = exactTokenAmount({
        chainId: row.version.chainId,
        amountBaseUnits: row.version.priceBaseUnits,
        decimals: row.version.paymentTokenDecimals,
        tokenAddress: row.version.paymentTokenAddress,
        symbol: row.version.currencySymbol,
      });
      const [agreement] = await transaction
        .insert(commerceAgreements)
        .values({
          principalId: input.buyerPrincipalId,
          agentId: row.session.agentId,
          serviceId: row.session.serviceId,
          offerId: row.offer.id,
          offerVersionId: row.version.id,
          mandateId: mandate.id,
          mandateVersion: 1,
          status: "DRAFT",
          currentVersion: 1,
          chainId: row.session.chainId,
          termsHash: row.version.termsHash,
          termsSnapshot: row.version.termsContent,
          pricingSnapshot,
          amountBaseUnits: row.version.priceBaseUnits,
          paymentTokenAddress: row.version.paymentTokenAddress,
          paymentTokenDecimals: row.version.paymentTokenDecimals,
          expiresAt: boundedRelationshipExpiresAt,
        })
        .returning({ id: commerceAgreements.id });
      if (agreement === undefined)
        throw new Error("Validation agreement insert failed");
      const [agreementVersion] = await transaction
        .insert(commerceAgreementVersions)
        .values({
          agreementId: agreement.id,
          version: 1,
          status: "DRAFT",
          offerVersionId: row.version.id,
          mandateId: mandate.id,
          mandateVersion: 1,
          termsHash: row.version.termsHash,
          termsSnapshot: row.version.termsContent,
          pricingSnapshot,
        })
        .returning({ id: commerceAgreementVersions.id });
      if (agreementVersion === undefined)
        throw new Error("Validation agreement version insert failed");
      await transaction.insert(commerceAgreementEvents).values({
        agreementId: agreement.id,
        agreementVersionId: agreementVersion.id,
        fromStatus: null,
        toStatus: "DRAFT",
        eventType: "VALIDATION_AGREEMENT_CREATED",
        actorPrincipalId: input.buyerPrincipalId,
        evidence: {
          validationSessionId: row.session.id,
          offerVersionId: row.version.id,
          termsHash: row.version.termsHash,
          purpose: "VERIFICATION",
          marketplaceHistoryEligible: false,
          transactionSubmitted: false,
        },
        occurredAt: now,
      });
      const [prepared] = await transaction
        .update(commerceValidationSessions)
        .set({
          mandateId: mandate.id,
          agreementId: agreement.id,
          updatedAt: now,
        })
        .where(
          and(
            eq(commerceValidationSessions.id, row.session.id),
            eq(commerceValidationSessions.status, "CLAIMED"),
            eq(
              commerceValidationSessions.buyerPrincipalId,
              input.buyerPrincipalId,
            ),
            isNull(commerceValidationSessions.mandateId),
            isNull(commerceValidationSessions.agreementId),
          ),
        )
        .returning();
      if (prepared === undefined)
        throw new Error("Validation preparation changed concurrently");
      await transaction.insert(agentOfferEvents).values({
        offerId: row.offer.id,
        offerVersionId: row.version.id,
        eventType: "COMMERCE_VALIDATION_PREPARED",
        actorPrincipalId: input.buyerPrincipalId,
        evidence: {
          validationSessionId: row.session.id,
          mandateId: mandate.id,
          agreementId: agreement.id,
          purpose: "VERIFICATION",
          marketplaceHistoryEligible: false,
          transactionSubmitted: false,
        },
        occurredAt: now,
      });
      return prepared;
    });
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
    if (agreement.expiresAt !== null && agreement.expiresAt <= new Date())
      throw new Error("Agreement has expired");
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
                or(
                  eq(executionRequests.status, "APPROVAL_REQUIRED"),
                  and(
                    eq(executionRequests.status, "SUCCEEDED"),
                    eq(executionRequests.decision, "ALLOW"),
                    sql`coalesce((${executionRequests.normalizedAction} ->> 'transactional')::boolean, false) = false`,
                  ),
                ),
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
        if (approval.length === 0) {
          const [existingApproval] = await transaction
            .select()
            .from(executionApprovals)
            .where(
              and(
                eq(executionApprovals.executionRequestId, execution.id),
                eq(executionApprovals.principalId, input.principalId),
                eq(executionApprovals.normalizedHash, execution.normalizedHash),
                eq(executionApprovals.approved, true),
                eq(executionApprovals.authorizationKind, "WALLET_EIP712"),
                eq(executionApprovals.walletAuthorization, true),
              ),
            )
            .limit(1);
          if (existingApproval === undefined)
            throw new Error(
              "Existing exact execution approval does not match this refresh",
            );
        }
        if (execution.status === "APPROVAL_REQUIRED") {
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
        }
        await transaction.insert(mandateEvents).values({
          mandateId: execution.mandateId,
          mandateVersionId: null,
          eventType: "EXECUTION_APPROVED",
          securitySensitive: true,
          details: {
            executionId: execution.id,
            authorizationKind: "WALLET_EIP712",
            walletAuthorization: true,
            authorizationRefresh: approval.length === 0,
            executionStatusPreserved:
              execution.status === "SUCCEEDED" ? "SUCCEEDED" : null,
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
            expiresAt: expiresAt.toISOString(),
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
        await transaction
          .update(commerceOperations)
          .set({
            evidence: sql`${commerceOperations.evidence} || ${JSON.stringify({
              exactActionAuthorizationId: artifact.id,
              authorizationExpiresAt: expiresAt.toISOString(),
            })}::jsonb`,
            updatedAt: new Date(),
          })
          .where(
            and(
              eq(commerceOperations.agreementId, agreement.id),
              eq(commerceOperations.executionRequestId, execution!.id),
              eq(commerceOperations.operationType, "CREATE_JOB"),
              eq(commerceOperations.state, "AWAITING_SIGNATURE"),
              isNull(commerceOperations.transactionHash),
            ),
          );
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

  public async authorizationArtifact(id: string, principalId: string) {
    const [row] = await this.database
      .select()
      .from(authorizationArtifacts)
      .where(
        and(
          eq(authorizationArtifacts.id, id),
          eq(authorizationArtifacts.principalId, principalId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  public async marketplaceServiceEndpoint(serviceId: string) {
    const [row] = await this.database
      .select({ endpoint: marketplaceServices.endpoint })
      .from(marketplaceServices)
      .where(eq(marketplaceServices.id, serviceId))
      .limit(1);
    return row?.endpoint ?? null;
  }

  public async commerceValidationContext(input: {
    agreementId: string;
    principalId: string;
  }) {
    const [row] = await this.database
      .select({
        agreement: commerceAgreements,
        session: commerceValidationSessions,
        offer: agentOffers,
        version: agentOfferVersions,
        service: marketplaceServices,
        identity: agentIdentities,
      })
      .from(commerceAgreements)
      .innerJoin(
        commerceValidationSessions,
        eq(commerceValidationSessions.agreementId, commerceAgreements.id),
      )
      .innerJoin(agentOffers, eq(agentOffers.id, commerceAgreements.offerId))
      .innerJoin(
        agentOfferVersions,
        eq(agentOfferVersions.id, commerceAgreements.offerVersionId),
      )
      .innerJoin(
        marketplaceServices,
        eq(marketplaceServices.id, commerceAgreements.serviceId),
      )
      .innerJoin(
        agentIdentities,
        eq(agentIdentities.agentId, commerceAgreements.agentId),
      )
      .where(
        and(
          eq(commerceAgreements.id, input.agreementId),
          eq(commerceAgreements.principalId, input.principalId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  public async prepareCommerceValidationActivation(input: {
    agreementId: string;
    principalId: string;
    clientAddress: string;
    commerceAddress: string;
    evaluatorAddress: string;
    providerAddress: string;
    approvalPayloadHash: string;
    approvalEvidence: Record<string, unknown>;
  }) {
    return this.database.transaction(async (transaction) => {
      const [context] = await transaction
        .select({
          agreement: commerceAgreements,
          session: commerceValidationSessions,
          identity: agentIdentities,
        })
        .from(commerceAgreements)
        .innerJoin(
          commerceValidationSessions,
          eq(commerceValidationSessions.agreementId, commerceAgreements.id),
        )
        .innerJoin(
          agentIdentities,
          eq(agentIdentities.agentId, commerceAgreements.agentId),
        )
        .where(
          and(
            eq(commerceAgreements.id, input.agreementId),
            eq(commerceAgreements.principalId, input.principalId),
          ),
        )
        .limit(1);
      if (
        context === undefined ||
        context.agreement.status !== "AUTHORIZED" ||
        context.agreement.authorizationArtifactId === null ||
        context.agreement.mandateId === null ||
        context.agreement.mandateVersion === null ||
        context.session.status !== "CLAIMED" ||
        context.session.expiresAt <= new Date() ||
        context.session.buyerPrincipalId !== input.principalId ||
        context.identity.ownerAddress.toLowerCase() !==
          input.providerAddress.toLowerCase()
      )
        throw new Error("Authorized commerce validation agreement is required");
      const [authorization] = await transaction
        .select()
        .from(authorizationArtifacts)
        .where(
          eq(
            authorizationArtifacts.id,
            context.agreement.authorizationArtifactId,
          ),
        )
        .limit(1);
      if (
        authorization === undefined ||
        authorization.verificationStatus !== "VERIFIED" ||
        authorization.revokedAt !== null ||
        authorization.expiresAt <= new Date() ||
        authorization.signerAddress?.toLowerCase() !==
          input.clientAddress.toLowerCase()
      )
        throw new Error("A current buyer wallet authorization is required");
      const [existing] = await transaction
        .select()
        .from(activations)
        .where(
          and(
            eq(activations.commerceAgreementId, context.agreement.id),
            eq(activations.purpose, "VERIFICATION"),
            inArray(activations.lifecycleState, [
              "PREPARING",
              "ONCHAIN_CREATED",
              "ACTIVE",
              "DELIVERED",
              "SETTLING",
            ]),
          ),
        )
        .limit(1);
      if (existing !== undefined) return existing;
      const [activation] = await transaction
        .insert(activations)
        .values({
          agentId: context.agreement.agentId,
          serviceId: context.agreement.serviceId,
          chainId: context.agreement.chainId,
          purpose: "VERIFICATION",
          marketplaceHistoryEligible: false,
          commerceAgreementId: context.agreement.id,
          mandateId: context.agreement.mandateId,
          mandateVersion: context.agreement.mandateVersion,
          principalId: input.principalId,
          acceptedTermsHash: context.agreement.termsHash,
          pricingSnapshot: context.agreement.pricingSnapshot,
          budgetBaseUnits: context.agreement.amountBaseUnits,
          paymentTokenDecimals: context.agreement.paymentTokenDecimals,
          authorizationId: context.agreement.authorizationArtifactId,
          commerceAddress: input.commerceAddress,
          clientAddress: input.clientAddress,
          providerAddress: input.providerAddress,
          evaluatorAddress: input.evaluatorAddress,
          currencyToken: context.agreement.paymentTokenAddress,
          lifecycleState: "PREPARING",
          status: "PREPARED",
        })
        .returning();
      if (activation === undefined)
        throw new Error("Validation activation insert failed");
      await transaction.insert(commerceOperations).values({
        agreementId: context.agreement.id,
        activationId: activation.id,
        operationType: "APPROVE_TOKEN",
        state: "AWAITING_SIGNATURE",
        idempotencyKey: `validation:${context.session.id}:approve-token`,
        preparedPayloadHash: input.approvalPayloadHash,
        evidence: input.approvalEvidence,
        nextAttemptAt: new Date(),
      });
      await transaction
        .update(commerceAgreements)
        .set({ status: "ACTIVE", updatedAt: new Date() })
        .where(
          and(
            eq(commerceAgreements.id, context.agreement.id),
            eq(commerceAgreements.status, "AUTHORIZED"),
          ),
        );
      await transaction.insert(commerceAgreementEvents).values({
        agreementId: context.agreement.id,
        fromStatus: "AUTHORIZED",
        toStatus: "ACTIVE",
        eventType: "COMMERCE_VALIDATION_PAYMENT_PREPARED",
        actorPrincipalId: input.principalId,
        evidence: {
          activationId: activation.id,
          validationSessionId: context.session.id,
          purpose: "VERIFICATION",
          marketplaceHistoryEligible: false,
          transactionSubmitted: false,
        },
      });
      return activation;
    });
  }

  public async refreshPreparedWalletOperation(input: {
    operationId: string;
    agreementId: string;
    principalId: string;
    previousPayloadHash: string;
    preparedPayloadHash: string;
    evidence: Record<string, unknown>;
  }) {
    const agreement = await this.#agreementRow(
      input.agreementId,
      input.principalId,
    );
    if (agreement === null) throw new Error("Commerce agreement not found");
    const [row] = await this.database
      .update(commerceOperations)
      .set({
        preparedPayloadHash: input.preparedPayloadHash,
        evidence: input.evidence,
        updatedAt: new Date(),
      })
      .where(
        and(
          eq(commerceOperations.id, input.operationId),
          eq(commerceOperations.agreementId, agreement.id),
          eq(commerceOperations.operationType, "CREATE_JOB"),
          eq(commerceOperations.state, "AWAITING_SIGNATURE"),
          eq(commerceOperations.preparedPayloadHash, input.previousPayloadHash),
          isNull(commerceOperations.transactionHash),
        ),
      )
      .returning();
    if (row === undefined)
      throw new Error("Commerce operation changed during quote refresh");
    return row;
  }

  public async walletOperationActivation(input: {
    activationId: string;
    agreementId: string;
    principalId: string;
  }) {
    const agreement = await this.#agreementRow(
      input.agreementId,
      input.principalId,
    );
    if (agreement === null) return null;
    const [row] = await this.database
      .select()
      .from(activations)
      .where(
        and(
          eq(activations.id, input.activationId),
          eq(activations.commerceAgreementId, agreement.id),
          eq(activations.principalId, input.principalId),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  public async createJobSubmissionContext(input: {
    activationId: string;
    agreementId: string;
    principalId: string;
  }) {
    const agreement = await this.#agreementRow(
      input.agreementId,
      input.principalId,
    );
    if (agreement === null) return null;
    const [row] = await this.database
      .select({
        activation: activations,
        mandateStatus: mandates.status,
        mandateCurrentVersion: mandates.currentVersion,
        mandateActiveVersion: mandates.activeVersion,
        serviceEndpoint: marketplaceServices.endpoint,
        serviceAvailability: marketplaceServices.availability,
        serviceVerificationLevel: marketplaceServices.verificationLevel,
        serviceLastVerifiedAt: marketplaceServices.lastVerifiedAt,
        executionStatus: executionRequests.status,
        executionHash: executionRequests.normalizedHash,
        executionAction: executionRequests.normalizedAction,
      })
      .from(activations)
      .innerJoin(mandates, eq(mandates.id, activations.mandateId))
      .innerJoin(
        marketplaceServices,
        eq(marketplaceServices.id, activations.serviceId),
      )
      .innerJoin(
        executionRequests,
        eq(executionRequests.id, activations.executionRequestId),
      )
      .where(
        and(
          eq(activations.id, input.activationId),
          eq(activations.commerceAgreementId, agreement.id),
          eq(activations.principalId, input.principalId),
        ),
      )
      .limit(1);
    return row === undefined ? null : { agreement, ...row };
  }

  public async recordWalletSubmittedOperation(input: {
    operationId: string;
    agreementId: string;
    principalId: string;
    transactionHash: string;
    signerAddress: string;
    preparedPayloadHash: string;
    nonce?: bigint;
  }) {
    const agreement = await this.#agreementRow(
      input.agreementId,
      input.principalId,
    );
    if (agreement === null) throw new Error("Commerce agreement not found");
    const submittedAt = new Date();
    const [row] = await this.database
      .update(commerceOperations)
      .set({
        state: "SUBMITTED",
        transactionHash: input.transactionHash,
        signerAddress: input.signerAddress,
        nonce: input.nonce,
        finalityState: "UNCONFIRMED",
        nextAttemptAt: submittedAt,
        evidence: sql`${commerceOperations.evidence} || ${JSON.stringify({
          walletSubmitted: true,
          transactionSubmitted: true,
          submittedAt: submittedAt.toISOString(),
          signerAddress: input.signerAddress,
          ...(input.nonce === undefined
            ? {}
            : { nonce: input.nonce.toString() }),
          preparedPayloadHash: input.preparedPayloadHash,
        })}::jsonb`,
        updatedAt: submittedAt,
      })
      .where(
        and(
          eq(commerceOperations.id, input.operationId),
          eq(commerceOperations.agreementId, agreement.id),
          inArray(commerceOperations.operationType, [
            "APPROVE_TOKEN",
            "CREATE_JOB",
            "REGISTER_JOB",
            "SET_BUDGET",
            "FUND",
          ]),
          eq(commerceOperations.state, "AWAITING_SIGNATURE"),
          eq(commerceOperations.preparedPayloadHash, input.preparedPayloadHash),
          isNull(commerceOperations.transactionHash),
        ),
      )
      .returning();
    if (row === undefined) {
      const [existing] = await this.database
        .select()
        .from(commerceOperations)
        .where(
          and(
            eq(commerceOperations.id, input.operationId),
            eq(commerceOperations.agreementId, agreement.id),
          ),
        )
        .limit(1);
      if (
        existing !== undefined &&
        existing.transactionHash?.toLowerCase() ===
          input.transactionHash.toLowerCase()
      )
        return existing;
      if (existing?.transactionHash !== null && existing !== undefined)
        throw new Error(
          "A different transaction hash is already recorded for this operation",
        );
      if (
        existing?.preparedPayloadHash?.toLowerCase() !==
        input.preparedPayloadHash.toLowerCase()
      )
        throw new Error("Prepared wallet transaction hash mismatch");
      throw new Error(
        "Commerce operation is no longer eligible for submission",
      );
    }
    return row;
  }

  public async findAgreement(id: string, principalId: string) {
    const row = await this.#agreementRow(id, principalId);
    if (row === null) return null;
    const [
      events,
      operations,
      movements,
      settlements,
      artifacts,
      authorizations,
    ] = await Promise.all([
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
      this.database
        .select({
          id: authorizationArtifacts.id,
          executionRequestId: authorizationArtifacts.executionRequestId,
          verificationStatus: authorizationArtifacts.verificationStatus,
          signerAddress: authorizationArtifacts.signerAddress,
          actionHash: authorizationArtifacts.actionHash,
          expiresAt: authorizationArtifacts.expiresAt,
          revokedAt: authorizationArtifacts.revokedAt,
          createdAt: authorizationArtifacts.createdAt,
        })
        .from(authorizationArtifacts)
        .where(eq(authorizationArtifacts.agreementId, id))
        .orderBy(asc(authorizationArtifacts.createdAt)),
    ]);
    return {
      ...row,
      events,
      operations: operations.map((operation) => ({
        ...operation,
        nonce: operation.nonce?.toString() ?? null,
        blockNumber: operation.blockNumber?.toString() ?? null,
      })),
      movements: movements.map((movement) => ({
        ...movement,
        blockNumber: movement.blockNumber?.toString() ?? null,
      })),
      settlements,
      artifacts,
      authorizations,
    };
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
        attempt: sql<number>`(
          select coalesce(max(existing.attempt), 0)::int + 1
          from commerce_operations existing
          where existing.agreement_id = ${input.agreementId}::uuid
            and existing.operation_type = ${input.operationType}::commerce_operation_type
        )`,
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

  public async prepareProviderDelivery(input: {
    agreementId: string;
    activationId: string;
    executionRequestId: string;
    externalJobId: string;
    providerAddress: string;
    idempotencyKey: string;
    manifestHash: string;
    manifestReference: string;
    manifest: Record<string, unknown>;
    observedAt: Date;
    preparedPayloadHash: string;
    operationEvidence: Record<string, unknown>;
  }) {
    return this.database.transaction(async (transaction) => {
      const [
        [activation],
        [agreement],
        existingOperations,
        movements,
        settlements,
      ] = await Promise.all([
        transaction
          .select()
          .from(activations)
          .where(eq(activations.id, input.activationId))
          .limit(1),
        transaction
          .select({ status: commerceAgreements.status })
          .from(commerceAgreements)
          .where(eq(commerceAgreements.id, input.agreementId))
          .limit(1),
        transaction
          .select()
          .from(commerceOperations)
          .where(
            and(
              eq(commerceOperations.activationId, input.activationId),
              eq(commerceOperations.operationType, "SUBMIT_DELIVERY"),
            ),
          ),
        transaction
          .select({ id: commerceValueMovements.id })
          .from(commerceValueMovements)
          .where(eq(commerceValueMovements.activationId, input.activationId)),
        transaction
          .select({ id: settlementRecords.id })
          .from(settlementRecords)
          .where(eq(settlementRecords.activationId, input.activationId)),
      ]);
      if (
        activation === undefined ||
        !["USER_COMMERCE", "VERIFICATION"].includes(activation.purpose) ||
        activation.commerceAgreementId !== input.agreementId ||
        activation.executionRequestId !== input.executionRequestId ||
        activation.externalJobId !== input.externalJobId ||
        activation.lifecycleState !== "ACTIVE" ||
        activation.status !== "FUNDED" ||
        activation.reconciliationState !== "CURRENT" ||
        activation.providerAddress?.toLowerCase() !==
          input.providerAddress.toLowerCase()
      )
        throw new Error(
          "FUNDED activation is not eligible for provider delivery",
        );
      if (agreement?.status !== "ACTIVE")
        throw new Error("An active commerce agreement is required");
      if (movements.length !== 0 || settlements.length !== 0)
        throw new Error("Zero-price delivery cannot have economic records");

      const existing = existingOperations[0];
      if (existing !== undefined) {
        if (
          existing.idempotencyKey !== input.idempotencyKey ||
          existing.preparedPayloadHash !== input.preparedPayloadHash ||
          existing.signerAddress?.toLowerCase() !==
            input.providerAddress.toLowerCase()
        )
          throw new Error("A different provider delivery is already prepared");
        const [artifact] = await transaction
          .select()
          .from(commerceArtifacts)
          .where(
            and(
              eq(commerceArtifacts.activationId, input.activationId),
              eq(commerceArtifacts.artifactType, "DELIVERY"),
              eq(commerceArtifacts.contentHash, input.manifestHash),
            ),
          )
          .limit(1);
        if (artifact === undefined)
          throw new Error(
            "Prepared provider delivery has no immutable artifact",
          );
        return { artifact, operation: existing };
      }

      const [insertedArtifact] = await transaction
        .insert(commerceArtifacts)
        .values({
          agreementId: input.agreementId,
          activationId: input.activationId,
          executionRequestId: input.executionRequestId,
          artifactType: "DELIVERY",
          source: "relic-health-factor-monitor",
          contentHash: input.manifestHash,
          contentReference: input.manifestReference,
          safeContent: input.manifest,
          provenance: "independently_observed",
          observedAt: input.observedAt,
        })
        .onConflictDoNothing({
          target: [
            commerceArtifacts.agreementId,
            commerceArtifacts.artifactType,
            commerceArtifacts.contentHash,
          ],
        })
        .returning();
      const artifact =
        insertedArtifact ??
        (
          await transaction
            .select()
            .from(commerceArtifacts)
            .where(
              and(
                eq(commerceArtifacts.agreementId, input.agreementId),
                eq(commerceArtifacts.artifactType, "DELIVERY"),
                eq(commerceArtifacts.contentHash, input.manifestHash),
              ),
            )
            .limit(1)
        )[0];
      if (artifact === undefined)
        throw new Error("Provider delivery artifact insert failed");

      const [operation] = await transaction
        .insert(commerceOperations)
        .values({
          agreementId: input.agreementId,
          activationId: input.activationId,
          executionRequestId: input.executionRequestId,
          operationType: "SUBMIT_DELIVERY",
          state: "AWAITING_SIGNATURE",
          idempotencyKey: input.idempotencyKey,
          attempt: sql<number>`(
            select coalesce(max(existing.attempt), 0)::int + 1
            from commerce_operations existing
            where existing.agreement_id = ${input.agreementId}::uuid
              and existing.operation_type = 'SUBMIT_DELIVERY'::commerce_operation_type
          )`,
          preparedPayloadHash: input.preparedPayloadHash,
          signerAddress: input.providerAddress,
          nextAttemptAt: input.observedAt,
          evidence: {
            ...input.operationEvidence,
            deliveryArtifactId: artifact.id,
            deliveryManifestHash: input.manifestHash,
            deliveryManifestReference: input.manifestReference,
            transactionPrepared: true,
            transactionSubmitted: false,
            fundsMoved: false,
            settlementCreated: false,
          },
        })
        .returning();
      if (operation === undefined)
        throw new Error("Provider delivery operation insert failed");
      return { artifact, operation };
    });
  }

  public async createUserCommerceActivation(input: {
    agreementId: string;
    executionRequestId: string;
    authorizationId: string;
    commerceAddress: string;
    clientAddress: string;
    evaluatorAddress: string;
  }) {
    const [existing] = await this.database
      .select()
      .from(activations)
      .where(
        and(
          eq(activations.purpose, "USER_COMMERCE"),
          eq(activations.commerceAgreementId, input.agreementId),
          eq(activations.executionRequestId, input.executionRequestId),
          eq(activations.authorizationId, input.authorizationId),
        ),
      )
      .limit(1);
    if (existing !== undefined) {
      if (
        existing.clientAddress?.toLowerCase() !==
          input.clientAddress.toLowerCase() ||
        existing.commerceAddress?.toLowerCase() !==
          input.commerceAddress.toLowerCase() ||
        existing.evaluatorAddress?.toLowerCase() !==
          input.evaluatorAddress.toLowerCase()
      )
        throw new Error(
          "Existing commerce activation does not match the requested routing",
        );
      return existing;
    }
    const [activationForExecution] = await this.database
      .select({ id: activations.id })
      .from(activations)
      .where(eq(activations.executionRequestId, input.executionRequestId))
      .limit(1);
    if (activationForExecution !== undefined)
      throw new Error(
        "This execution already belongs to a commerce activation; run a fresh policy-controlled observation",
      );
    const agreement = await this.#agreementRowById(input.agreementId);
    if (
      agreement === null ||
      !["AUTHORIZED", "ACTIVE"].includes(agreement.status) ||
      (agreement.status === "AUTHORIZED" &&
        agreement.authorizationArtifactId !== input.authorizationId) ||
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
          agreementId: authorizationArtifacts.agreementId,
          executionRequestId: authorizationArtifacts.executionRequestId,
          mandateId: authorizationArtifacts.mandateId,
          mandateVersion: authorizationArtifacts.mandateVersion,
          actionHash: authorizationArtifacts.actionHash,
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
      const replacement = agreement.status === "ACTIVE";
      if (replacement) {
        if (
          authorization.actionHash === null ||
          authorization.agreementId !== agreement.id ||
          authorization.executionRequestId !== execution.id ||
          authorization.mandateId !== agreement.mandateId ||
          authorization.mandateVersion !== agreement.mandateVersion
        )
          throw new Error(
            "A replacement activation requires a current exact-action authorization",
          );
        const activeAttempts = await transaction
          .select({ id: activations.id })
          .from(activations)
          .where(
            and(
              eq(activations.commerceAgreementId, agreement.id),
              eq(activations.purpose, "USER_COMMERCE"),
              inArray(activations.lifecycleState, [
                "PREPARING",
                "NEGOTIATING",
                "AWAITING_AUTHORIZATION",
                "ONCHAIN_CREATED",
                "ACTIVE",
                "DELIVERED",
                "SETTLING",
              ]),
            ),
          );
        if (activeAttempts.length !== 0)
          throw new Error(
            "A non-terminal commerce activation already exists for this agreement",
          );
      } else {
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
          throw new Error(
            "Agreement changed before activation could be created",
          );
      }
      const [prepareAttemptResult] = await transaction
        .select({
          value: sql<number>`coalesce(max(${commerceOperations.attempt}), 0)::int + 1`,
        })
        .from(commerceOperations)
        .where(
          and(
            eq(commerceOperations.agreementId, agreement.id),
            eq(commerceOperations.operationType, "PREPARE_JOB"),
          ),
        );
      const prepareAttempt = prepareAttemptResult?.value ?? 1;
      const [row] = await transaction
        .insert(activations)
        .values({
          agentId: agreement.agentId,
          serviceId: agreement.serviceId,
          chainId: agreement.chainId,
          purpose: "USER_COMMERCE",
          marketplaceHistoryEligible: true,
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
        fromStatus: replacement ? "ACTIVE" : "AUTHORIZED",
        toStatus: "ACTIVE",
        eventType: replacement
          ? "COMMERCE_ACTIVATION_REPLACED"
          : "COMMERCE_ACTIVATION_CREATED",
        actorPrincipalId: agreement.principalId,
        evidence: {
          activationId: row.id,
          executionRequestId: execution.id,
          replacement,
        },
      });
      await transaction.insert(commerceOperations).values({
        agreementId: agreement.id,
        activationId: row.id,
        executionRequestId: execution.id,
        operationType: "PREPARE_JOB",
        state: "CREATED",
        idempotencyKey: `activation:${row.id}:prepare-job`,
        attempt: prepareAttempt,
        evidence: {
          userCommerce: true,
          replacement,
          transactionPrepared: false,
          transactionSubmitted: false,
        },
      });
      if (replacement) {
        const [createAttemptResult] = await transaction
          .select({
            value: sql<number>`coalesce(max(${commerceOperations.attempt}), 0)::int + 1`,
          })
          .from(commerceOperations)
          .where(
            and(
              eq(commerceOperations.agreementId, agreement.id),
              eq(commerceOperations.operationType, "CREATE_JOB"),
            ),
          );
        const createAttempt = createAttemptResult?.value ?? 1;
        const monitoredAccount = asObject(
          execution.normalizedAction,
        ).parameters;
        const account = asObject(monitoredAccount).account;
        if (typeof account !== "string")
          throw new Error("Replacement execution has no monitored account");
        await transaction.insert(commerceOperations).values({
          agreementId: agreement.id,
          activationId: row.id,
          executionRequestId: execution.id,
          operationType: "CREATE_JOB",
          state: "AWAITING_SIGNATURE",
          idempotencyKey: `activation:${row.id}:create-job`,
          attempt: createAttempt,
          preparedPayloadHash: immutableContentHash({
            state: "awaiting-fresh-seller-negotiation",
            activationId: row.id,
            executionRequestId: execution.id,
            authorizationId: input.authorizationId,
          }),
          evidence: {
            userCommerce: true,
            replacement: true,
            expiredActivationReplaced: true,
            exactActionAuthorizationId: input.authorizationId,
            authorizationExpiresAt: authorization.expiresAt.toISOString(),
            actionHash: authorization.actionHash,
            monitoredAccount: account,
            contract: input.commerceAddress,
            functionArguments: { provider: identity.ownerAddress },
            transactionPrepared: false,
            transactionSubmitted: false,
          },
        });
      }
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

  public async expireUnsubmittedCommerceAttempt(input: {
    activationId: string;
    operationId: string;
    externalJobId: string;
    observedAt: Date;
    observedBlock: bigint;
    observedBlockHash: string;
    jobExpiry: Date;
    evidence: Record<string, unknown>;
  }) {
    const failure = {
      code: "ERC8183_JOB_EXPIRED",
      externalJobId: input.externalJobId,
      jobExpiry: input.jobExpiry.toISOString(),
      observedAt: input.observedAt.toISOString(),
      observedBlock: input.observedBlock.toString(),
      observedBlockHash: input.observedBlockHash,
    };
    const evidence = { ...input.evidence, ...failure };
    return this.database.transaction(async (transaction) => {
      const [activation] = await transaction
        .select()
        .from(activations)
        .where(eq(activations.id, input.activationId))
        .limit(1);
      if (
        activation === undefined ||
        !["USER_COMMERCE", "VERIFICATION"].includes(activation.purpose) ||
        activation.externalJobId !== input.externalJobId ||
        activation.commerceAgreementId === null ||
        activation.principalId === null
      )
        throw new Error(
          "Expired commerce activation does not match the observed job",
        );
      const [operation] = await transaction
        .select()
        .from(commerceOperations)
        .where(
          and(
            eq(commerceOperations.id, input.operationId),
            eq(commerceOperations.activationId, activation.id),
          ),
        )
        .limit(1);
      if (
        operation === undefined ||
        operation.operationType !== "SET_BUDGET" ||
        operation.transactionHash !== null
      )
        throw new Error(
          "Only the unsigned SET_BUDGET operation may be cancelled",
        );
      if (
        activation.lifecycleState === "FAILED" &&
        operation.state === "CANCELLED"
      )
        return { activation, operation };
      if (
        activation.lifecycleState !== "ONCHAIN_CREATED" ||
        operation.state !== "AWAITING_SIGNATURE"
      )
        throw new Error(
          "Expired commerce attempt changed before reconciliation",
        );
      assertActivationLifecycleTransition("ONCHAIN_CREATED", "FAILED");
      const [changedActivation] = await transaction
        .update(activations)
        .set({
          lifecycleState: "FAILED",
          status: legacyActivationStatusForLifecycle("FAILED"),
          reconciliationState: "FAILED",
          failure,
          updatedAt: input.observedAt,
        })
        .where(
          and(
            eq(activations.id, activation.id),
            eq(activations.lifecycleState, "ONCHAIN_CREATED"),
          ),
        )
        .returning();
      if (changedActivation === undefined)
        throw new Error("Expired commerce activation changed concurrently");
      const [cancelledOperation] = await transaction
        .update(commerceOperations)
        .set({
          state: "CANCELLED",
          failure,
          evidence: {
            ...asObject(operation.evidence),
            expiryReconciliation: evidence,
          },
          nextAttemptAt: null,
          updatedAt: input.observedAt,
        })
        .where(
          and(
            eq(commerceOperations.id, operation.id),
            eq(commerceOperations.state, "AWAITING_SIGNATURE"),
            isNull(commerceOperations.transactionHash),
          ),
        )
        .returning();
      if (cancelledOperation === undefined)
        throw new Error("Unsigned SET_BUDGET operation changed concurrently");
      await transaction.insert(activationLifecycleTransitions).values({
        activationId: activation.id,
        fromState: "ONCHAIN_CREATED",
        toState: "FAILED",
        evidence,
        blockNumber: input.observedBlock,
      });
      await transaction.insert(activationTransitions).values({
        activationId: activation.id,
        status: legacyActivationStatusForLifecycle("FAILED"),
        blockNumber: input.observedBlock,
        evidence: {
          compatibilityProjection: true,
          canonicalLifecycleState: "FAILED",
          terminalReason: "ERC8183_JOB_EXPIRED",
        },
      });
      await transaction.insert(commerceAgreementEvents).values({
        agreementId: activation.commerceAgreementId,
        fromStatus: "ACTIVE",
        toStatus: "ACTIVE",
        eventType: "ERC8183_JOB_EXPIRED",
        actorPrincipalId: activation.principalId,
        evidence: {
          ...evidence,
          agreementPreserved: true,
          cancelledOperationId: operation.id,
        },
      });
      await transaction.insert(commerceArtifacts).values({
        agreementId: activation.commerceAgreementId,
        activationId: activation.id,
        executionRequestId: activation.executionRequestId,
        artifactType: "JOB_SPECIFICATION",
        source: "erc8183-expiry-reconciliation",
        contentHash: immutableContentHash({
          activationId: activation.id,
          operationId: operation.id,
          ...failure,
        }),
        safeContent: {
          externalJobId: input.externalJobId,
          terminalReason: failure.code,
          jobExpiry: failure.jobExpiry,
          observedAt: failure.observedAt,
          observedBlock: failure.observedBlock,
          observedBlockHash: failure.observedBlockHash,
          transactionHash: null,
          fundsMoved: false,
          settlementCreated: false,
        },
        provenance: "onchain_verified",
        observedAt: input.observedAt,
      });
      return { activation: changedActivation, operation: cancelledOperation };
    });
  }

  public async failFundedCommerceAttemptForQuoteWindow(input: {
    activationId: string;
    externalJobId: string;
    providerArtifactId: string;
    negotiatedAt: Date;
    quoteExpiresAt: Date;
    fundedAt: Date;
    observedAt: Date;
    observedBlock: bigint;
    observedBlockHash: string;
    evidence: Record<string, unknown>;
  }) {
    if (input.fundedAt <= input.quoteExpiresAt)
      throw new Error("Funded time does not exceed the signed quote window");
    const failure = {
      code: "SIGNED_QUOTE_WINDOW_EXPIRED",
      externalJobId: input.externalJobId,
      negotiatedAt: input.negotiatedAt.toISOString(),
      quoteExpiresAt: input.quoteExpiresAt.toISOString(),
      fundedAt: input.fundedAt.toISOString(),
      observedAt: input.observedAt.toISOString(),
      observedBlock: input.observedBlock.toString(),
      observedBlockHash: input.observedBlockHash,
      fundsMoved: false,
      settlementCreated: false,
      providerSubmissionRefused: true,
    };
    const evidence = { ...input.evidence, ...failure };
    return this.database.transaction(async (transaction) => {
      const [activation] = await transaction
        .select()
        .from(activations)
        .where(eq(activations.id, input.activationId))
        .limit(1);
      if (
        activation === undefined ||
        !["USER_COMMERCE", "VERIFICATION"].includes(activation.purpose) ||
        activation.externalJobId !== input.externalJobId ||
        activation.commerceAgreementId === null ||
        activation.principalId === null
      )
        throw new Error("Quote-window failure does not match the activation");
      const [providerArtifact] = await transaction
        .select()
        .from(commerceArtifacts)
        .where(
          and(
            eq(commerceArtifacts.id, input.providerArtifactId),
            eq(commerceArtifacts.activationId, activation.id),
            eq(commerceArtifacts.artifactType, "DELIVERY"),
          ),
        )
        .limit(1);
      if (providerArtifact === undefined)
        throw new Error(
          "Provider observation artifact is not bound to the job",
        );
      const [fundOperation, submitOperation, movements, settlements] =
        await Promise.all([
          transaction
            .select({ id: commerceOperations.id })
            .from(commerceOperations)
            .where(
              and(
                eq(commerceOperations.activationId, activation.id),
                eq(commerceOperations.operationType, "FUND"),
                eq(commerceOperations.state, "FINALIZED"),
              ),
            )
            .limit(1),
          transaction
            .select({ id: commerceOperations.id })
            .from(commerceOperations)
            .where(
              and(
                eq(commerceOperations.activationId, activation.id),
                eq(commerceOperations.operationType, "SUBMIT_DELIVERY"),
              ),
            )
            .limit(1),
          transaction
            .select({ id: commerceValueMovements.id })
            .from(commerceValueMovements)
            .where(eq(commerceValueMovements.activationId, activation.id)),
          transaction
            .select({ id: settlementRecords.id })
            .from(settlementRecords)
            .where(eq(settlementRecords.activationId, activation.id)),
        ]);
      if (fundOperation.length !== 1)
        throw new Error("A finalized FUND operation is required");
      if (submitOperation.length !== 0)
        throw new Error("Provider submission already exists");
      if (movements.length !== 0 || settlements.length !== 0)
        throw new Error("Zero-price quote failure has economic records");
      if (
        activation.lifecycleState === "FAILED" &&
        asObject(activation.failure).code === failure.code
      )
        return { activation, providerArtifact };
      if (activation.lifecycleState !== "ONCHAIN_CREATED")
        throw new Error(
          "Quote-window activation changed before reconciliation",
        );
      assertActivationLifecycleTransition("ONCHAIN_CREATED", "FAILED");
      const [changedActivation] = await transaction
        .update(activations)
        .set({
          lifecycleState: "FAILED",
          status: legacyActivationStatusForLifecycle("FAILED"),
          reconciliationState: "FAILED",
          failure,
          updatedAt: input.observedAt,
        })
        .where(
          and(
            eq(activations.id, activation.id),
            eq(activations.lifecycleState, "ONCHAIN_CREATED"),
          ),
        )
        .returning();
      if (changedActivation === undefined)
        throw new Error("Quote-window activation changed concurrently");
      await transaction.insert(activationLifecycleTransitions).values({
        activationId: activation.id,
        fromState: "ONCHAIN_CREATED",
        toState: "FAILED",
        evidence,
        blockNumber: input.observedBlock,
      });
      await transaction.insert(activationTransitions).values({
        activationId: activation.id,
        status: legacyActivationStatusForLifecycle("FAILED"),
        blockNumber: input.observedBlock,
        evidence: {
          compatibilityProjection: true,
          canonicalLifecycleState: "FAILED",
          terminalReason: failure.code,
        },
      });
      await transaction.insert(commerceAgreementEvents).values({
        agreementId: activation.commerceAgreementId,
        fromStatus: "ACTIVE",
        toStatus: "ACTIVE",
        eventType: "ERC8183_SIGNED_QUOTE_WINDOW_EXPIRED",
        actorPrincipalId: activation.principalId,
        evidence: {
          ...evidence,
          agreementPreserved: true,
          providerArtifactId: providerArtifact.id,
          providerArtifactAcceptedOnchain: false,
          successfulCommerceOutcome: false,
        },
      });
      await transaction.insert(commerceArtifacts).values({
        agreementId: activation.commerceAgreementId,
        activationId: activation.id,
        executionRequestId: activation.executionRequestId,
        artifactType: "JOB_SPECIFICATION",
        source: "erc8183-quote-window-reconciliation",
        contentHash: immutableContentHash({
          activationId: activation.id,
          providerArtifactId: providerArtifact.id,
          ...failure,
        }),
        safeContent: {
          ...failure,
          onchainJobState: "FUNDED",
          budgetBaseUnits: "0",
          providerWorkObserved: true,
          providerArtifactId: providerArtifact.id,
          providerArtifactAcceptedOnchain: false,
          successfulCommerceOutcome: false,
        },
        provenance: "onchain_verified",
        observedAt: input.observedAt,
      });
      return { activation: changedActivation, providerArtifact };
    });
  }

  public async leaseOperations(input: {
    workerId: string;
    limit: number;
    leaseSeconds: number;
    operationId?: string;
    now?: Date;
  }) {
    const now = input.now ?? new Date();
    const leaseExpiresAt = new Date(now.getTime() + input.leaseSeconds * 1_000);
    const nowTimestamp = now.toISOString();
    const leaseExpiresTimestamp = leaseExpiresAt.toISOString();
    const operationId = input.operationId ?? null;
    const result = await this.database.execute(sql`
      with candidates as (
        select id from commerce_operations
        where state in ('READY', 'SUBMITTED', 'PENDING', 'CONFIRMED', 'REORGED')
          and (${operationId}::uuid is null or id = ${operationId}::uuid)
          and (next_attempt_at is null or next_attempt_at <= ${nowTimestamp})
          and (lease_expires_at is null or lease_expires_at <= ${nowTimestamp})
        order by coalesce(next_attempt_at, created_at), created_at
        for update skip locked
        limit ${input.limit}
      )
      update commerce_operations o
      set lease_owner = ${input.workerId}, lease_expires_at = ${leaseExpiresTimestamp},
          updated_at = ${nowTimestamp}
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
        evidence:
          input.evidence === undefined
            ? undefined
            : sql`${commerceOperations.evidence} || ${JSON.stringify(input.evidence)}::jsonb`,
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

  public async finalizeCreateJobOperation(input: {
    id: string;
    workerId: string;
    from: CommerceOperationState[];
    transactionHash: string;
    blockNumber: bigint;
    blockHash: string;
    confirmationCount: number;
    externalJobId: string;
    evidence: Record<string, unknown>;
    nextOperation?: PreparedSetupOperation;
  }) {
    return this.database.transaction(async (transaction) => {
      const [operation] = await transaction
        .select()
        .from(commerceOperations)
        .where(
          and(
            eq(commerceOperations.id, input.id),
            eq(commerceOperations.leaseOwner, input.workerId),
            eq(commerceOperations.operationType, "CREATE_JOB"),
            inArray(commerceOperations.state, input.from),
          ),
        )
        .limit(1);
      if (operation === undefined) return null;
      if (
        operation.activationId === null ||
        operation.transactionHash?.toLowerCase() !==
          input.transactionHash.toLowerCase()
      )
        throw new Error(
          "Finalized CREATE_JOB does not match its durable operation",
        );
      const [activation] = await transaction
        .select()
        .from(activations)
        .where(eq(activations.id, operation.activationId))
        .limit(1);
      if (
        activation === undefined ||
        !["USER_COMMERCE", "VERIFICATION"].includes(activation.purpose) ||
        activation.commerceAgreementId !== operation.agreementId ||
        activation.executionRequestId !== operation.executionRequestId ||
        activation.lifecycleState !== "PREPARING" ||
        activation.reconciliationState !== "PENDING" ||
        activation.externalJobId !== null ||
        activation.principalId === null
      )
        throw new Error(
          "CREATE_JOB activation is not eligible for finality projection",
        );
      assertActivationLifecycleTransition("PREPARING", "ONCHAIN_CREATED");
      const observedAt = new Date();
      const receiptEvidence = {
        ...input.evidence,
        transactionHash: input.transactionHash,
        blockNumber: input.blockNumber.toString(),
        blockHash: input.blockHash,
        confirmationCount: input.confirmationCount,
        externalJobId: input.externalJobId,
      };
      const [finalizedOperation] = await transaction
        .update(commerceOperations)
        .set({
          state: "FINALIZED",
          blockNumber: input.blockNumber,
          blockHash: input.blockHash,
          confirmationCount: input.confirmationCount,
          finalityState: "FINALIZED",
          failure: null,
          evidence: sql`${commerceOperations.evidence} || ${JSON.stringify(receiptEvidence)}::jsonb`,
          nextAttemptAt: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: observedAt,
        })
        .where(
          and(
            eq(commerceOperations.id, operation.id),
            eq(commerceOperations.leaseOwner, input.workerId),
            inArray(commerceOperations.state, input.from),
          ),
        )
        .returning();
      if (finalizedOperation === undefined)
        throw new Error("CREATE_JOB operation changed during finalization");
      const lifecycleEvidence = {
        sourceOperationId: operation.id,
        receipt: receiptEvidence,
        fundsMoved: false,
        settlementCreated: false,
      };
      const [changedActivation] = await transaction
        .update(activations)
        .set({
          lifecycleState: "ONCHAIN_CREATED",
          status: legacyActivationStatusForLifecycle("ONCHAIN_CREATED"),
          reconciliationState: "CURRENT",
          externalJobId: input.externalJobId,
          updatedAt: observedAt,
        })
        .where(
          and(
            eq(activations.id, activation.id),
            eq(activations.lifecycleState, "PREPARING"),
          ),
        )
        .returning();
      if (changedActivation === undefined)
        throw new Error("CREATE_JOB activation changed during finalization");
      await transaction.insert(commerceAgreementEvents).values({
        agreementId: operation.agreementId,
        fromStatus: null,
        toStatus: "ACTIVE",
        eventType: "ERC8183_ONCHAIN_CREATED",
        actorPrincipalId: activation.principalId,
        evidence: lifecycleEvidence,
      });
      await transaction.insert(activationLifecycleTransitions).values({
        activationId: activation.id,
        fromState: "PREPARING",
        toState: "ONCHAIN_CREATED",
        transactionHash: input.transactionHash,
        blockNumber: input.blockNumber,
        evidence: lifecycleEvidence,
      });
      await transaction.insert(activationTransitions).values({
        activationId: activation.id,
        status: legacyActivationStatusForLifecycle("ONCHAIN_CREATED"),
        transactionHash: input.transactionHash,
        blockNumber: input.blockNumber,
        evidence: {
          compatibilityProjection: true,
          canonicalLifecycleState: "ONCHAIN_CREATED",
          externalJobId: input.externalJobId,
        },
      });
      await transaction.insert(commerceArtifacts).values({
        agreementId: operation.agreementId,
        activationId: activation.id,
        executionRequestId: operation.executionRequestId,
        artifactType: "JOB_SPECIFICATION",
        source: "erc8183-lifecycle-reconciliation",
        contentHash: immutableContentHash({
          activationId: activation.id,
          operationId: operation.id,
          externalJobId: input.externalJobId,
          transactionHash: input.transactionHash,
          blockNumber: input.blockNumber.toString(),
          blockHash: input.blockHash,
        }),
        safeContent: lifecycleEvidence,
        provenance: "onchain_verified",
        observedAt,
      });
      if (input.nextOperation !== undefined) {
        const [nextAttemptResult] = await transaction
          .select({
            value: sql<number>`coalesce(max(${commerceOperations.attempt}), 0)::int + 1`,
          })
          .from(commerceOperations)
          .where(
            and(
              eq(commerceOperations.agreementId, operation.agreementId),
              eq(
                commerceOperations.operationType,
                input.nextOperation.operationType,
              ),
            ),
          );
        await transaction
          .insert(commerceOperations)
          .values({
            agreementId: operation.agreementId,
            activationId: activation.id,
            executionRequestId: operation.executionRequestId,
            operationType: input.nextOperation.operationType,
            state: input.nextOperation.state,
            idempotencyKey: input.nextOperation.idempotencyKey,
            attempt: nextAttemptResult?.value ?? 1,
            preparedPayloadHash: input.nextOperation.preparedPayloadHash,
            failure: input.nextOperation.failure,
            evidence: input.nextOperation.evidence,
            nextAttemptAt:
              input.nextOperation.state === "AWAITING_SIGNATURE"
                ? observedAt
                : null,
          })
          .onConflictDoNothing({
            target: [
              commerceOperations.agreementId,
              commerceOperations.idempotencyKey,
            ],
          });
        if (input.nextOperation.state === "CANCELLED") {
          const [activation] = await transaction
            .select()
            .from(activations)
            .where(eq(activations.id, operation.activationId))
            .limit(1);
          if (
            activation === undefined ||
            !["USER_COMMERCE", "VERIFICATION"].includes(activation.purpose) ||
            activation.commerceAgreementId === null ||
            activation.principalId === null ||
            activation.lifecycleState !== "ONCHAIN_CREATED"
          )
            throw new Error(
              "Cancelled setup operation does not match an active commerce attempt",
            );
          assertActivationLifecycleTransition("ONCHAIN_CREATED", "FAILED");
          const failure = {
            ...input.nextOperation.failure,
            failedAfterOperation: operation.operationType,
            fundsMoved: false,
            settlementCreated: false,
            observedAt: observedAt.toISOString(),
          };
          const [failedActivation] = await transaction
            .update(activations)
            .set({
              lifecycleState: "FAILED",
              status: legacyActivationStatusForLifecycle("FAILED"),
              reconciliationState: "FAILED",
              failure,
              updatedAt: observedAt,
            })
            .where(
              and(
                eq(activations.id, activation.id),
                eq(activations.lifecycleState, "ONCHAIN_CREATED"),
              ),
            )
            .returning({ id: activations.id });
          if (failedActivation === undefined)
            throw new Error(
              "Commerce activation changed while closing its setup window",
            );
          await transaction.insert(activationLifecycleTransitions).values({
            activationId: activation.id,
            fromState: "ONCHAIN_CREATED",
            toState: "FAILED",
            transactionHash: input.transactionHash,
            blockNumber: input.blockNumber,
            evidence: failure,
          });
          await transaction.insert(activationTransitions).values({
            activationId: activation.id,
            status: legacyActivationStatusForLifecycle("FAILED"),
            transactionHash: input.transactionHash,
            blockNumber: input.blockNumber,
            evidence: {
              compatibilityProjection: true,
              canonicalLifecycleState: "FAILED",
              terminalReason: input.nextOperation.failure?.code,
            },
          });
          await transaction.insert(commerceAgreementEvents).values({
            agreementId: activation.commerceAgreementId,
            fromStatus: "ACTIVE",
            toStatus: "ACTIVE",
            eventType: "ERC8183_SETUP_WINDOW_CLOSED",
            actorPrincipalId: activation.principalId,
            evidence: { ...failure, agreementPreserved: true },
          });
        }
      }
      return { operation: finalizedOperation, activation: changedActivation };
    });
  }

  public async finalizeSetupOperation(input: {
    id: string;
    workerId: string;
    from: CommerceOperationState[];
    transactionHash: string;
    blockNumber: bigint;
    blockHash: string;
    confirmationCount: number;
    evidence: Record<string, unknown>;
    nextOperation?: PreparedSetupOperation;
  }) {
    return this.database.transaction(async (transaction) => {
      const [operation] = await transaction
        .select()
        .from(commerceOperations)
        .where(
          and(
            eq(commerceOperations.id, input.id),
            eq(commerceOperations.leaseOwner, input.workerId),
            inArray(commerceOperations.operationType, [
              "APPROVE_TOKEN",
              "REGISTER_JOB",
              "SET_BUDGET",
              "FUND",
            ]),
            inArray(commerceOperations.state, input.from),
          ),
        )
        .limit(1);
      if (
        operation === undefined ||
        operation.activationId === null ||
        operation.transactionHash?.toLowerCase() !==
          input.transactionHash.toLowerCase()
      )
        return null;
      const observedAt = new Date();
      const operationEvidence = operation.evidence as Record<string, unknown>;
      const amountBaseUnits = operationEvidence.amountBaseUnits;
      const fundedAmount =
        typeof amountBaseUnits === "string" && /^\d+$/.test(amountBaseUnits)
          ? BigInt(amountBaseUnits)
          : 0n;
      const receiptEvidence = {
        ...input.evidence,
        transactionHash: input.transactionHash,
        blockNumber: input.blockNumber.toString(),
        blockHash: input.blockHash,
        confirmationCount: input.confirmationCount,
        fundsMoved: operation.operationType === "FUND" && fundedAmount > 0n,
        settlementCreated: false,
      };
      const [finalized] = await transaction
        .update(commerceOperations)
        .set({
          state: "FINALIZED",
          blockNumber: input.blockNumber,
          blockHash: input.blockHash,
          confirmationCount: input.confirmationCount,
          finalityState: "FINALIZED",
          failure: null,
          evidence: sql`${commerceOperations.evidence} || ${JSON.stringify(receiptEvidence)}::jsonb`,
          nextAttemptAt: null,
          leaseOwner: null,
          leaseExpiresAt: null,
          updatedAt: observedAt,
        })
        .where(
          and(
            eq(commerceOperations.id, operation.id),
            eq(commerceOperations.leaseOwner, input.workerId),
            inArray(commerceOperations.state, input.from),
          ),
        )
        .returning();
      if (finalized === undefined)
        throw new Error("Commerce setup operation changed during finalization");
      if (input.nextOperation !== undefined) {
        const [nextAttemptResult] = await transaction
          .select({
            value: sql<number>`coalesce(max(${commerceOperations.attempt}), 0)::int + 1`,
          })
          .from(commerceOperations)
          .where(
            and(
              eq(commerceOperations.agreementId, operation.agreementId),
              eq(
                commerceOperations.operationType,
                input.nextOperation.operationType,
              ),
            ),
          );
        await transaction
          .insert(commerceOperations)
          .values({
            agreementId: operation.agreementId,
            activationId: operation.activationId,
            executionRequestId: operation.executionRequestId,
            operationType: input.nextOperation.operationType,
            state: input.nextOperation.state,
            idempotencyKey: input.nextOperation.idempotencyKey,
            attempt: nextAttemptResult?.value ?? 1,
            preparedPayloadHash: input.nextOperation.preparedPayloadHash,
            failure: input.nextOperation.failure,
            evidence: input.nextOperation.evidence,
            nextAttemptAt:
              input.nextOperation.state === "AWAITING_SIGNATURE"
                ? observedAt
                : null,
          })
          .onConflictDoNothing({
            target: [
              commerceOperations.agreementId,
              commerceOperations.idempotencyKey,
            ],
          });
        if (input.nextOperation.state === "CANCELLED") {
          const [activation] = await transaction
            .select()
            .from(activations)
            .where(eq(activations.id, operation.activationId))
            .limit(1);
          const expectedLifecycleState =
            operation.operationType === "APPROVE_TOKEN"
              ? "PREPARING"
              : "ONCHAIN_CREATED";
          if (
            activation === undefined ||
            !["USER_COMMERCE", "VERIFICATION"].includes(activation.purpose) ||
            activation.commerceAgreementId === null ||
            activation.principalId === null ||
            activation.lifecycleState !== expectedLifecycleState
          )
            throw new Error(
              "Cancelled setup operation does not match an active commerce attempt",
            );
          assertActivationLifecycleTransition(expectedLifecycleState, "FAILED");
          const failure = {
            ...input.nextOperation.failure,
            failedAfterOperation: operation.operationType,
            fundsMoved: false,
            settlementCreated: false,
            observedAt: observedAt.toISOString(),
          };
          const [failedActivation] = await transaction
            .update(activations)
            .set({
              lifecycleState: "FAILED",
              status: legacyActivationStatusForLifecycle("FAILED"),
              reconciliationState: "FAILED",
              failure,
              updatedAt: observedAt,
            })
            .where(
              and(
                eq(activations.id, activation.id),
                eq(activations.lifecycleState, expectedLifecycleState),
              ),
            )
            .returning({ id: activations.id });
          if (failedActivation === undefined)
            throw new Error(
              "Commerce activation changed while closing its setup window",
            );
          await transaction.insert(activationLifecycleTransitions).values({
            activationId: activation.id,
            fromState: expectedLifecycleState,
            toState: "FAILED",
            transactionHash: input.transactionHash,
            blockNumber: input.blockNumber,
            evidence: failure,
          });
          await transaction.insert(activationTransitions).values({
            activationId: activation.id,
            status: legacyActivationStatusForLifecycle("FAILED"),
            transactionHash: input.transactionHash,
            blockNumber: input.blockNumber,
            evidence: {
              compatibilityProjection: true,
              canonicalLifecycleState: "FAILED",
              terminalReason: input.nextOperation.failure?.code,
            },
          });
          await transaction.insert(commerceAgreementEvents).values({
            agreementId: activation.commerceAgreementId,
            fromStatus: "ACTIVE",
            toStatus: "ACTIVE",
            eventType: "ERC8183_SETUP_WINDOW_CLOSED",
            actorPrincipalId: activation.principalId,
            evidence: { ...failure, agreementPreserved: true },
          });
        }
      }
      if (operation.operationType === "FUND") {
        const [activation] = await transaction
          .select()
          .from(activations)
          .where(eq(activations.id, operation.activationId))
          .limit(1);
        if (
          activation === undefined ||
          !["USER_COMMERCE", "VERIFICATION"].includes(activation.purpose) ||
          activation.commerceAgreementId === null ||
          activation.principalId === null ||
          activation.lifecycleState !== "ONCHAIN_CREATED"
        )
          throw new Error(
            "Finalized FUND does not match an onchain-created commerce activation",
          );
        assertActivationLifecycleTransition("ONCHAIN_CREATED", "ACTIVE");
        const budgetBaseUnits = activation.budgetBaseUnits ?? "0";
        const paid = BigInt(budgetBaseUnits) > 0n;
        const lifecycleEvidence = {
          operationId: operation.id,
          transactionHash: input.transactionHash,
          blockNumber: input.blockNumber.toString(),
          blockHash: input.blockHash,
          confirmationCount: input.confirmationCount,
          budgetBaseUnits,
          fundsMoved: paid,
          settlementCreated: false,
          zeroValueProtocolTransition: !paid,
        };
        const [activeActivation] = await transaction
          .update(activations)
          .set({
            lifecycleState: "ACTIVE",
            status: legacyActivationStatusForLifecycle("ACTIVE"),
            reconciliationState: "CURRENT",
            budget: budgetBaseUnits,
            failure: null,
            updatedAt: observedAt,
          })
          .where(
            and(
              eq(activations.id, activation.id),
              eq(activations.lifecycleState, "ONCHAIN_CREATED"),
            ),
          )
          .returning({ id: activations.id });
        if (activeActivation === undefined)
          throw new Error("Commerce activation changed while finalizing FUND");
        await transaction.insert(activationLifecycleTransitions).values({
          activationId: activation.id,
          fromState: "ONCHAIN_CREATED",
          toState: "ACTIVE",
          transactionHash: input.transactionHash,
          blockNumber: input.blockNumber,
          evidence: lifecycleEvidence,
        });
        await transaction.insert(activationTransitions).values({
          activationId: activation.id,
          status: legacyActivationStatusForLifecycle("ACTIVE"),
          transactionHash: input.transactionHash,
          blockNumber: input.blockNumber,
          evidence: {
            compatibilityProjection: true,
            canonicalLifecycleState: "ACTIVE",
            zeroValueProtocolTransition: !paid,
            fundsMoved: paid,
          },
        });
        await transaction.insert(commerceAgreementEvents).values({
          agreementId: activation.commerceAgreementId,
          fromStatus: "ACTIVE",
          toStatus: "ACTIVE",
          eventType: paid ? "ERC8183_FUNDED" : "ERC8183_ZERO_VALUE_FUNDED",
          actorPrincipalId: activation.principalId,
          evidence: lifecycleEvidence,
        });
        if (paid) {
          if (
            activation.currencyToken === null ||
            activation.paymentTokenDecimals === null ||
            activation.clientAddress === null ||
            activation.commerceAddress === null
          )
            throw new Error("Paid validation funding evidence is incomplete");
          await transaction.insert(commerceValueMovements).values({
            agreementId: activation.commerceAgreementId,
            activationId: activation.id,
            sourceOperationId: operation.id,
            movementType: "ESCROW_LOCK",
            chainId: activation.chainId,
            tokenAddress: activation.currencyToken,
            tokenDecimals: activation.paymentTokenDecimals,
            amountBaseUnits: budgetBaseUnits,
            payerAddress: activation.clientAddress,
            payeeAddress: activation.commerceAddress,
            transactionHash: input.transactionHash,
            blockNumber: input.blockNumber,
            blockHash: input.blockHash,
            finalityState: "FINALIZED",
            provenance: "onchain_verified",
          });
        }
      }
      return finalized;
    });
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
    if (BigInt(input.amountBaseUnits) <= 0n)
      throw new Error(
        "Economic value movements must be positive; record zero-value protocol transitions as lifecycle evidence",
      );
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
            "SCHEMA_UNDERSTOOD",
            "INVOCATION_VERIFIED",
            "COMMERCE_VERIFIED",
          ]),
          gt(marketplaceServices.lastVerifiedAt, freshness),
          inArray(launchCandidates.status, [
            "SERVICE_OBSERVED",
            "INVOCATION_VERIFIED",
            "ACTIONABLE",
          ]),
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
