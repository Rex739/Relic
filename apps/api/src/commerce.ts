import { createHash, randomBytes } from "node:crypto";

import {
  buildJobDescription,
  verifyQuoteSignature,
} from "@bnbagent/sdk/erc8183";
import type {
  CommerceAuthorization,
  CreateOfferRequest,
  MarketplaceReviewRole,
  MarketplaceReviewSentiment,
} from "@relic/domain";
import {
  agreementAuthorizationTypedData,
  commerceAuthorizationSchema,
  commerceAuthorizationTypedData,
  erc8183PaymentTokens,
  executionApprovalTypedData,
  formatBaseUnits,
  isMarketplaceReviewTag,
  MandateValidationError,
} from "@relic/domain";
import type {
  DrizzleCommerceStore,
  DrizzleWalletAuthStore,
} from "@relic/database";
import {
  negotiateOfferBoundService,
} from "@relic/validation";
import {
  createPublicClient,
  encodeFunctionData,
  getAddress,
  hashTypedData,
  keccak256,
  http,
  recoverMessageAddress,
  recoverTypedDataAddress,
  stringToHex,
} from "viem";
import { bscTestnet } from "viem/chains";

import type { SellerAuthorizationGuard } from "./seller-ownership.js";
import type { ServicePublicationVerifier } from "./service-publication.js";

const createJobAbi = [
  {
    type: "function",
    name: "createJob",
    stateMutability: "nonpayable",
    inputs: [
      { name: "provider", type: "address" },
      { name: "evaluator", type: "address" },
      { name: "expiredAt", type: "uint256" },
      { name: "description", type: "string" },
      { name: "hook", type: "address" },
    ],
    outputs: [{ name: "jobId", type: "uint256" }],
  },
] as const;

const erc20ApprovalAbi = [
  {
    type: "function",
    name: "approve",
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const paymentTokenAbi = [
  {
    type: "function",
    name: "paymentToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
] as const;

const displayServicePrice = (agreement: {
  amountBaseUnits?: string;
  paymentTokenDecimals?: number;
  chainId: number;
}) => {
  // A free offer has no token amount to format. In particular, older/free
  // agreements need not carry a payment-token decimal precision.
  if (agreement.amountBaseUnits === undefined) return "Price unavailable";
  if (BigInt(agreement.amountBaseUnits) === 0n) return "Free";
  if (agreement.paymentTokenDecimals === undefined)
    return "Price unavailable";
  const token = erc8183PaymentTokens[
    agreement.chainId as keyof typeof erc8183PaymentTokens
  ];
  const amount = formatBaseUnits(
    agreement.amountBaseUnits,
    agreement.paymentTokenDecimals,
  );
  return token === undefined ? amount : `${amount} ${token.symbol}`;
};

const commerceJobAbi = [
  {
    type: "function",
    name: "getJob",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "client", type: "address" },
          { name: "provider", type: "address" },
          { name: "evaluator", type: "address" },
          { name: "description", type: "string" },
          { name: "budget", type: "uint256" },
          { name: "expiredAt", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "hook", type: "address" },
          { name: "submittedAt", type: "uint256" },
          { name: "deliverable", type: "bytes32" },
        ],
      },
    ],
  },
  {
    type: "function",
    name: "jobHasBudget",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [{ name: "hasBudget", type: "bool" }],
  },
  {
    type: "function",
    name: "setBudget",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "amount", type: "uint256" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
  {
    type: "function",
    name: "fund",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "expectedBudget", type: "uint256" },
      { name: "optParams", type: "bytes" },
    ],
    outputs: [],
  },
] as const;

const registerJobAbi = [
  {
    type: "function",
    name: "jobPolicy",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "policyWhitelist",
    stateMutability: "view",
    inputs: [{ name: "policy", type: "address" }],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    type: "function",
    name: "registerJob",
    stateMutability: "nonpayable",
    inputs: [
      { name: "jobId", type: "uint256" },
      { name: "policy", type: "address" },
    ],
    outputs: [],
  },
] as const;

const zeroAddress = "0x0000000000000000000000000000000000000000";

export const USER_COMMERCE_JOB_LIFETIME_SECONDS = 7n * 86_400n;
export const COMMERCE_VALIDATION_JOB_LIFETIME_SECONDS = 7n * 86_400n;
export const SDK_MAX_SIGNED_QUOTE_TTL_SECONDS = 900;
export const USER_COMMERCE_CREATE_QUOTE_HEADROOM_SECONDS = 12 * 60;
export const USER_COMMERCE_SETUP_GAS_RESERVE_UNITS = 2_000_000n;
export const activationSetupRequiredGasBalance = (gasPrice: bigint) =>
  gasPrice * USER_COMMERCE_SETUP_GAS_RESERVE_UNITS;
export const commerceValidationJobExpiry = (input: {
  nowSeconds: bigint;
  disputeWindowSeconds: bigint;
  relationshipExpiresAtSeconds: bigint;
}) => {
  if (input.disputeWindowSeconds <= 0n)
    throw new Error("ERC-8183 validation policy is not ready");
  const earliestSafeJobExpiry =
    input.nowSeconds + input.disputeWindowSeconds;
  if (input.relationshipExpiresAtSeconds <= earliestSafeJobExpiry)
    throw new Error(
      "Validation relationship expires before the policy-safe job window",
    );
  const requestedJobExpiry =
    earliestSafeJobExpiry + COMMERCE_VALIDATION_JOB_LIFETIME_SECONDS;
  return requestedJobExpiry < input.relationshipExpiresAtSeconds
    ? requestedJobExpiry
    : input.relationshipExpiresAtSeconds;
};
const USER_COMMERCE_QUOTE_HEADROOM_BY_OPERATION = {
  REGISTER_JOB: 8 * 60,
  SET_BUDGET: 4 * 60,
  FUND: 2 * 60,
} as const;

const policyReadinessAbi = [
  {
    type: "function",
    name: "disputeWindow",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");
const canonicalize = (value: unknown): unknown =>
  Array.isArray(value)
    ? value.map(canonicalize)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(
          Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right))
            .map(([key, item]) => [key, canonicalize(item)]),
        )
      : value;
const canonicalJson = (value: unknown) => JSON.stringify(canonicalize(value));
const signedQuoteWindow = (description: string) => {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(description) as Record<string, unknown>;
  } catch {
    throw new Error("ERC-8183 job description is not a signed quote");
  }
  const negotiatedAt = parsed.negotiated_at;
  const quoteExpiresAt = parsed.quote_expires_at;
  if (
    typeof negotiatedAt !== "number" ||
    !Number.isSafeInteger(negotiatedAt) ||
    typeof quoteExpiresAt !== "number" ||
    !Number.isSafeInteger(quoteExpiresAt) ||
    quoteExpiresAt <= negotiatedAt ||
    quoteExpiresAt - negotiatedAt > SDK_MAX_SIGNED_QUOTE_TTL_SECONDS
  )
    throw new Error("ERC-8183 signed quote window is invalid");
  return { negotiatedAt, quoteExpiresAt };
};
const requireSignedQuoteHeadroom = (
  description: string,
  operation: keyof typeof USER_COMMERCE_QUOTE_HEADROOM_BY_OPERATION,
  nowSeconds: number,
) => {
  const window = signedQuoteWindow(description);
  const required = USER_COMMERCE_QUOTE_HEADROOM_BY_OPERATION[operation];
  if (window.quoteExpiresAt - nowSeconds < required)
    throw new Error(
      `Seller quote has insufficient remaining lifetime for ${operation}; prepare a fresh commerce attempt`,
    );
  return { ...window, requiredHeadroomSeconds: required };
};
const sanitizeClaim = (value: unknown) => {
  const text =
    typeof value === "string"
      ? value
      : typeof value === "number" || typeof value === "boolean"
        ? String(value)
        : "";
  return text
    .replaceAll("[", "(")
    .replaceAll("]", ")")
    .split("")
    .filter(
      (character) => character >= " " || ["\t", "\n", "\r"].includes(character),
    )
    .join("");
};

export const principalIdForWallet = (address: string, chainId: number) => {
  const bytes = Buffer.from(
    sha256(`eip155:${chainId}:${getAddress(address).toLowerCase()}`).slice(
      0,
      32,
    ),
    "hex",
  );
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
};

export interface WalletSessionPrincipal {
  principalId: string;
  walletAddress: `0x${string}`;
  chainId: number;
  sessionId: string;
}

export class WalletAuthenticationService {
  public constructor(
    private readonly store: DrizzleWalletAuthStore,
    private readonly domain: string,
    private readonly uri: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async challenge(addressValue: string, chainId: number) {
    const address = getAddress(addressValue);
    const nonce = randomBytes(32).toString("hex");
    const issuedAt = this.now();
    const expiresAt = new Date(issuedAt.getTime() + 5 * 60_000);
    const message = [
      `${this.domain} wants you to sign in with your Ethereum account:`,
      address,
      "",
      "Authenticate to Relic. This does not authorize a transaction or payment.",
      "",
      `URI: ${this.uri}`,
      `Version: 1`,
      `Chain ID: ${chainId}`,
      `Nonce: ${nonce}`,
      `Issued At: ${issuedAt.toISOString()}`,
      `Expiration Time: ${expiresAt.toISOString()}`,
    ].join("\n");
    const id = await this.store.createChallenge({
      walletAddress: address,
      chainId,
      nonceHash: sha256(nonce),
      message,
      expiresAt,
    });
    return {
      id,
      address,
      chainId,
      message,
      expiresAt: expiresAt.toISOString(),
    };
  }

  public async verify(input: {
    challengeId: string;
    address: string;
    chainId: number;
    signature: `0x${string}`;
  }) {
    const address = getAddress(input.address);
    const challenge = await this.store.findChallenge(input.challengeId);
    if (
      challenge === null ||
      challenge.consumedAt !== null ||
      challenge.expiresAt <= this.now() ||
      challenge.chainId !== input.chainId ||
      getAddress(challenge.walletAddress) !== address
    )
      throw new Error("Wallet challenge is invalid, expired, or already used");
    const recovered = await recoverMessageAddress({
      message: challenge.message,
      signature: input.signature,
    });
    if (getAddress(recovered) !== address)
      throw new Error("Wallet challenge signer does not match");
    const consumed = await this.store.consumeChallenge({
      id: challenge.id,
      walletAddress: address,
      chainId: input.chainId,
      now: this.now(),
    });
    if (consumed === null) throw new Error("Wallet challenge replay detected");
    return this.establishSession(address, input.chainId);
  }

  /**
   * Creates a Relic session after an authentication boundary has proven that
   * the caller controls this exact wallet. Wallet signatures and Privy token
   * verification are separate boundaries that deliberately converge here.
   */
  public async establishSession(addressValue: string, chainId: number) {
    const address = getAddress(addressValue);
    const sessionToken = randomBytes(48).toString("base64url");
    const expiresAt = new Date(this.now().getTime() + 8 * 60 * 60_000);
    const principalId = principalIdForWallet(address, chainId);
    const sessionId = await this.store.createSession({
      principalId,
      walletAddress: address,
      chainId,
      sessionTokenHash: sha256(sessionToken),
      expiresAt,
    });
    return {
      sessionToken,
      principal: {
        principalId,
        walletAddress: address,
        chainId,
        sessionId,
      },
      expiresAt: expiresAt.toISOString(),
    };
  }

  public async session(token: string): Promise<WalletSessionPrincipal | null> {
    const session = await this.store.session(sha256(token), this.now());
    if (session === null) return null;
    return {
      principalId: session.principalId,
      walletAddress: getAddress(session.walletAddress),
      chainId: session.chainId,
      sessionId: session.id,
    };
  }

  public revoke(token: string) {
    return this.store.revokeSession(sha256(token), this.now());
  }
}

export class CommerceApplicationService {
  public constructor(
    private readonly store: DrizzleCommerceStore,
    private readonly verifyingContract: `0x${string}`,
    private readonly now: () => Date = () => new Date(),
    private readonly erc8183?: {
      commerceAddress: `0x${string}`;
      evaluatorAddress: `0x${string}`;
      policyAddress?: `0x${string}`;
      rpcUrl?: string;
    },
    private readonly sellerAuthorization?: SellerAuthorizationGuard,
    private readonly publicationVerifier?: ServicePublicationVerifier,
  ) {}

  public async marketplaceReviewEligibility(
    principal: WalletSessionPrincipal,
    activationId: string,
    reviewerRole: MarketplaceReviewRole,
  ) {
    return this.store.marketplaceReviewEligibility({
      activationId,
      principalId: principal.principalId,
      walletAddress: principal.walletAddress,
      reviewerRole,
    });
  }

  public async createMarketplaceReview(
    principal: WalletSessionPrincipal,
    input: {
      activationId: string;
      reviewerRole: MarketplaceReviewRole;
      sentiment: MarketplaceReviewSentiment;
      tags: string[];
      message?: string | null | undefined;
    },
  ) {
    if (
      input.tags.some(
        (tag) =>
          !isMarketplaceReviewTag({
            role: input.reviewerRole,
            sentiment: input.sentiment,
            tag,
          }),
      )
    )
      throw new MandateValidationError(
        "review_tags_invalid",
        "One or more review tags do not match this review",
      );
    const eligibility = await this.marketplaceReviewEligibility(
      principal,
      input.activationId,
      input.reviewerRole,
    );
    if (!eligibility.eligible)
      throw new MandateValidationError(
        `review_${eligibility.reason}`,
        eligibility.reason === "already_reviewed"
          ? "This marketplace job has already been reviewed by this party"
          : "Only a completed genuine marketplace job can be reviewed by its buyer or agent",
      );
    return this.store.createMarketplaceReview({
      activationId: eligibility.activationId,
      agreementId: eligibility.agreementId,
      reviewerPrincipalId: principal.principalId,
      reviewerRole: eligibility.reviewerRole,
      subjectType: eligibility.subjectType,
      subjectAgentId:
        eligibility.subjectType === "AGENT" ? eligibility.agentId : null,
      subjectPrincipalId:
        eligibility.subjectType === "BUYER"
          ? eligibility.buyerPrincipalId
          : null,
      sentiment: input.sentiment,
      tags: [...new Set(input.tags)],
      message: input.message?.trim() || null,
      eligibilityProvenance: {
        rule: "completed_user_commerce_v1",
        activationId: eligibility.activationId,
        agreementId: eligibility.agreementId,
        marketplaceHistoryEligible: true,
        commerceSuccessful: true,
      },
    });
  }

  public async createOffer(
    principal: WalletSessionPrincipal,
    request: CreateOfferRequest,
  ) {
    if (principal.chainId !== request.chainId)
      throw new Error("Wallet session network does not match the offer");
    const authorization =
      this.sellerAuthorization === undefined
        ? null
        : await this.sellerAuthorization.assertAuthorized(
            principal.principalId,
            request.agentId,
          );
    return this.store.createOffer({
      operatorPrincipalId: principal.principalId,
      operatorAddress: authorization?.verifiedOwner ?? principal.walletAddress,
      request,
    });
  }

  public async activateOffer(
    principal: WalletSessionPrincipal,
    offerId: string,
  ) {
    const offer = await this.store.findOffer(offerId);
    if (offer === null) throw new Error("Offer not found for this operator");
    const authorization =
      this.sellerAuthorization === undefined
        ? null
        : await this.sellerAuthorization.assertAuthorized(
            principal.principalId,
            offer.agentId,
          );
    // Publication is a safe quote-only preflight. Running it before the
    // offer changes state keeps seller UI and marketplace eligibility aligned.
    await this.publicationVerifier?.verify(offer);
    return this.store.activateOffer({
      offerId,
      operatorPrincipalId: principal.principalId,
      operatorAddress: authorization?.verifiedOwner ?? principal.walletAddress,
    });
  }

  public async transitionOffer(
    principal: WalletSessionPrincipal,
    offerId: string,
    to: "PAUSED" | "DEACTIVATED",
  ) {
    const offer = await this.store.findOffer(offerId);
    if (offer === null) throw new Error("Offer not found for this operator");
    if (this.sellerAuthorization !== undefined)
      await this.sellerAuthorization.assertAuthorized(
        principal.principalId,
        offer.agentId,
      );
    return this.store.transitionOffer({
      offerId,
      operatorPrincipalId: principal.principalId,
      to,
    });
  }

  public async reviseOffer(
    principal: WalletSessionPrincipal,
    offerId: string,
    request: CreateOfferRequest,
  ) {
    if (principal.chainId !== request.chainId)
      throw new Error("Wallet session network does not match the offer");
    const authorization =
      this.sellerAuthorization === undefined
        ? null
        : await this.sellerAuthorization.assertAuthorized(
            principal.principalId,
            request.agentId,
          );
    return this.store.reviseOffer({
      offerId,
      operatorPrincipalId: principal.principalId,
      operatorAddress: authorization?.verifiedOwner ?? principal.walletAddress,
      request,
    });
  }

  public operatorOffers(principal: WalletSessionPrincipal) {
    return this.store.operatorOffers(principal.principalId);
  }

  public operatorAgreements(principal: WalletSessionPrincipal) {
    return this.store.operatorAgreements(principal.principalId);
  }

  public async createCommerceValidationSession(
    principal: WalletSessionPrincipal,
    offerId: string,
  ) {
    const offer = await this.store.findOffer(offerId);
    if (offer === null) throw new Error("Offer not found for this operator");
    if (offer.version.chainId !== principal.chainId)
      throw new Error("Wallet session network does not match the offer");
    if (this.sellerAuthorization !== undefined)
      await this.sellerAuthorization.assertAuthorized(
        principal.principalId,
        offer.agentId,
      );
    const handoffToken = randomBytes(32).toString("base64url");
    const expiresAt = new Date(this.now().getTime() + 60 * 60_000);
    const created = await this.store.createCommerceValidationSession({
      offerId,
      sellerPrincipalId: principal.principalId,
      handoffTokenHash: sha256(handoffToken),
      expiresAt,
      now: this.now(),
    });
    return {
      session: {
        ...created.session,
        expiresAt: created.session.expiresAt.toISOString(),
        createdAt: created.session.createdAt.toISOString(),
        updatedAt: created.session.updatedAt.toISOString(),
      },
      offer: created.offer,
      handoffToken,
    };
  }

  public async commerceValidationSession(
    sessionId: string,
    handoffToken: string,
  ) {
    const session = await this.store.commerceValidationSession({
      sessionId,
      handoffTokenHash: sha256(handoffToken),
      now: this.now(),
    });
    if (session === null) return null;
    const offer = await this.store.findOffer(session.offerId);
    if (offer === null || offer.version.id !== session.offerVersionId)
      throw new Error("Validation session offer snapshot is unavailable");
    const publicSession = Object.fromEntries(
      Object.entries(session).filter(
        ([key]) =>
          ![
            "buyerPrincipalId",
            "handoffTokenHash",
            "sellerPrincipalId",
          ].includes(key),
      ),
    );
    return {
      session: {
        ...publicSession,
        buyerClaimed: session.buyerPrincipalId !== null,
        expiresAt: session.expiresAt.toISOString(),
        createdAt: session.createdAt.toISOString(),
        updatedAt: session.updatedAt.toISOString(),
      },
      offer,
    };
  }

  public async claimCommerceValidationSession(
    principal: WalletSessionPrincipal,
    sessionId: string,
    handoffToken: string,
  ) {
    const claimed = await this.store.claimCommerceValidationSession({
      sessionId,
      handoffTokenHash: sha256(handoffToken),
      buyerPrincipalId: principal.principalId,
      buyerAddress: principal.walletAddress,
      chainId: principal.chainId,
      now: this.now(),
    });
    const prepared = await this.store.prepareCommerceValidationSession({
      sessionId,
      handoffTokenHash: sha256(handoffToken),
      buyerPrincipalId: principal.principalId,
      now: this.now(),
    });
    const offer = await this.store.findOffer(claimed.offerId);
    if (offer === null || offer.version.id !== claimed.offerVersionId)
      throw new Error("Validation session offer snapshot is unavailable");
    const publicSession = Object.fromEntries(
      Object.entries(prepared).filter(
        ([key]) =>
          ![
            "buyerPrincipalId",
            "handoffTokenHash",
            "sellerPrincipalId",
          ].includes(key),
      ),
    );
    return {
      session: {
        ...publicSession,
        expiresAt: prepared.expiresAt.toISOString(),
        createdAt: prepared.createdAt.toISOString(),
        updatedAt: prepared.updatedAt.toISOString(),
      },
      offer,
      nextState: "REVIEW_VALIDATION_AGREEMENT" as const,
      transactionSubmitted: false,
    };
  }

  public offers(agentId: string) {
    return this.store.activeOffersForAgent(agentId);
  }

  public async hire(
    principal: WalletSessionPrincipal,
    offerId: string,
    mandateId: string,
  ) {
    const offer = await this.store.findOffer(offerId);
    if (offer === null || offer.version.chainId !== principal.chainId)
      throw new Error("Wallet session network does not match the offer");
    return this.store.createAgreement({
      principalId: principal.principalId,
      offerId,
      mandateId,
    });
  }

  public agreement(principal: WalletSessionPrincipal, agreementId: string) {
    return this.store.findAgreement(agreementId, principal.principalId);
  }

  public agreements(principal: WalletSessionPrincipal) {
    return this.store.listAgreements(principal.principalId);
  }

  public agreementSummaries(principal: WalletSessionPrincipal) {
    return this.store.listAgreementSummaries(principal.principalId);
  }

  public async prepareCommerceValidation(
    principal: WalletSessionPrincipal,
    agreementId: string,
  ) {
    if (
      this.erc8183?.rpcUrl === undefined ||
      this.erc8183.policyAddress === undefined
    )
      throw new Error("ERC-8183 validation infrastructure is unavailable");
    let current = await this.store.findAgreement(
      agreementId,
      principal.principalId,
    );
    if (
      current?.status === "ACTIVE" &&
      current.operations.some(
        (operation) => {
          const evidence = operation.evidence as Record<string, unknown>;
          // A legacy CREATE_JOB can look pending, but cannot be reused: it has
          // no provider-negotiated quote and would otherwise revive the old
          // zero-price setup path.
          return (
            evidence.commerceValidation === true &&
            evidence.quote !== null &&
            typeof evidence.quote === "object" &&
            operation.state === "AWAITING_SIGNATURE" &&
            ["APPROVE_TOKEN", "CREATE_JOB"].includes(operation.operationType)
          );
        },
      )
    )
      return current;
    if (current?.status === "ACTIVE") {
      await this.store.supersedeUnsignedLegacyActivationForValidation({
        agreementId,
        principalId: principal.principalId,
      });
      current = await this.store.findAgreement(
        agreementId,
        principal.principalId,
      );
    }
    const context = await this.store.commerceValidationContext({
      agreementId,
      principalId: principal.principalId,
    });
    const relationshipExpiresAt =
      context?.agreement.expiresAt ?? context?.mandateVersion.expiresAt ?? null;
    if (
      context === null ||
      context.agreement.status !== "AUTHORIZED" ||
      context.agreement.chainId !== principal.chainId ||
      relationshipExpiresAt === null ||
      relationshipExpiresAt <= this.now() ||
      context.offer.status !== "ACTIVE" ||
      context.offer.currentVersion !== context.version.version ||
      context.service.availability !== "available" ||
      context.service.endpoint === null
    )
      throw new Error("Authorized current validation agreement is required");
    const commerce = getAddress(this.erc8183.commerceAddress);
    const router = getAddress(this.erc8183.evaluatorAddress);
    const provider = getAddress(context.identity.ownerAddress);
    const token = getAddress(context.agreement.paymentTokenAddress);
    const client = createPublicClient({
      chain: bscTestnet,
      transport: http(this.erc8183.rpcUrl),
    });
    const policy = getAddress(this.erc8183.policyAddress);
    const amount = BigInt(context.agreement.amountBaseUnits);
    const [
      connectedChainId,
      liveToken,
      disputeWindow,
      policyAllowed,
      policyCode,
      buyerBalance,
      gasPrice,
      buyerTokenBalance,
    ] = await Promise.all([
      client.getChainId(),
      client.readContract({
        address: commerce,
        abi: paymentTokenAbi,
        functionName: "paymentToken",
      }),
      client.readContract({
        address: policy,
        abi: policyReadinessAbi,
        functionName: "disputeWindow",
      }),
      client.readContract({
        address: router,
        abi: registerJobAbi,
        functionName: "policyWhitelist",
        args: [policy],
      }),
      client.getCode({ address: policy }),
      client.getBalance({ address: principal.walletAddress }),
      client.getGasPrice(),
      client.readContract({
        address: token,
        abi: erc20ApprovalAbi,
        functionName: "balanceOf",
        args: [principal.walletAddress],
      }),
    ]);
    if (getAddress(liveToken) !== token)
      throw new Error(
        "Offer payment token does not match the commerce contract",
      );
    const requiredGasBalance = activationSetupRequiredGasBalance(gasPrice);
    const readinessIssues = [
      ...(connectedChainId !== 97
        ? ["wallet is not connected to BSC Testnet"]
        : []),
      ...(disputeWindow <= 0n || !policyAllowed || policyCode === undefined || policyCode === "0x"
        ? ["this service's checkout policy is not ready"]
        : []),
    ];
    if (readinessIssues.length > 0)
      throw new Error(`Checkout is not ready: ${readinessIssues.join("; ")}.`);
    const negotiated = await negotiateOfferBoundService({
      endpoint: context.service.endpoint,
      interfaceProtocol: context.service.interfaceProtocol,
      agreementId: context.agreement.id,
      offerId: context.offer.id,
      offerVersionId: context.version.id,
      capability: context.version.capability,
      terms: context.agreement.termsSnapshot,
      termsHash: context.agreement.termsHash,
      limitations: Array.isArray(context.version.limitationsSnapshot)
        ? context.version.limitationsSnapshot.map(String)
        : [],
      chainId: context.agreement.chainId,
      amountBaseUnits: context.agreement.amountBaseUnits,
      paymentTokenAddress: token,
    });
    if (getAddress(negotiated.quote.verifying_contract) !== commerce)
      throw new Error(
        "Provider quote is bound to an unexpected commerce contract",
      );
    const signature = await verifyQuoteSignature({
      envelope: negotiated.quote,
      provider,
      publicClient: client,
      expectedVerifyingContract: commerce,
    });
    if (!signature.valid)
      throw new Error(
        `Provider quote signature is invalid: ${signature.reason}`,
      );
    const nowSeconds = Math.floor(this.now().getTime() / 1_000);
    if (
      negotiated.quote.response.quote_expires_at - nowSeconds <
      USER_COMMERCE_CREATE_QUOTE_HEADROOM_SECONDS
    )
      throw new Error(
        "Provider quote has insufficient time for manual wallet setup",
      );
    const description = buildJobDescription(negotiated.quote);
    const jobExpiresAt = commerceValidationJobExpiry({
      nowSeconds: BigInt(nowSeconds),
      disputeWindowSeconds: disputeWindow,
      relationshipExpiresAtSeconds: BigInt(
        Math.floor(relationshipExpiresAt.getTime() / 1_000),
      ),
    });
    const createData = encodeFunctionData({
      abi: createJobAbi,
      functionName: "createJob",
      args: [provider, router, jobExpiresAt, description, router],
    });
    const approvalData = encodeFunctionData({
      abi: erc20ApprovalAbi,
      functionName: "approve",
      args: [commerce, amount],
    });
    await this.store.prepareCommerceValidationActivation({
      agreementId,
      principalId: principal.principalId,
      clientAddress: principal.walletAddress,
      commerceAddress: commerce,
      evaluatorAddress: router,
      providerAddress: provider,
      approvalPayloadHash: keccak256(approvalData),
      approvalEvidence: {
        commerceValidation: true,
        marketplaceHistoryEligible: false,
        transactionPrepared: true,
        transactionSubmitted: false,
        walletPreflight: {
          nativeBalance: buyerBalance.toString(),
          requiredGasReserve: requiredGasBalance.toString(),
          paymentTokenBalance: buyerTokenBalance.toString(),
          requiredPaymentTokenAmount: amount.toString(),
        },
        contract: token,
        calldata: approvalData,
        preparedPayloadHash: keccak256(approvalData),
        functionArguments: { spender: commerce, amount: amount.toString() },
        quote: {
          requestHash: negotiated.quote.request_hash,
          responseHash: negotiated.quote.response_hash,
          negotiationHash: negotiated.quote.negotiation_hash,
          responseSha256: negotiated.responseSha256,
          signatureMethod: signature.method,
          negotiatedAt: negotiated.quote.response.negotiated_at,
          quoteExpiresAt: negotiated.quote.response.quote_expires_at,
        },
        nextOperation: {
          operationType: "CREATE_JOB",
          contract: commerce,
          calldata: createData,
          preparedPayloadHash: keccak256(createData),
          functionArguments: {
            provider,
            evaluator: router,
            expiredAt: jobExpiresAt.toString(),
            description,
            hook: router,
          },
          commerceAddress: commerce,
          routerAddress: router,
          policyAddress: policy,
          disputeWindowSeconds: disputeWindow.toString(),
          negotiatedAt: negotiated.quote.response.negotiated_at,
          quoteExpiresAt: negotiated.quote.response.quote_expires_at,
          jobExpiresAt: jobExpiresAt.toString(),
          amountBaseUnits: amount.toString(),
          paymentTokenAddress: token,
        },
      },
    });
    return this.store.findAgreement(agreementId, principal.principalId);
  }

  public async preparedWalletTransaction(
    principal: WalletSessionPrincipal,
    agreementId: string,
    operationId: string,
  ) {
    const agreement = await this.store.findAgreement(
      agreementId,
      principal.principalId,
    );
    const operation = agreement?.operations.find(
      (candidate) => candidate.id === operationId,
    );
    const validationEvidence = operation?.evidence as
      Record<string, unknown> | undefined;
    const validationOperation = validationEvidence?.commerceValidation === true;
    if (
      agreement !== null &&
      agreement.status === "ACTIVE" &&
      operation !== undefined &&
      validationOperation &&
      ["APPROVE_TOKEN", "CREATE_JOB"].includes(operation.operationType) &&
      operation.state === "AWAITING_SIGNATURE" &&
      operation.transactionHash === null &&
      operation.preparedPayloadHash !== null
    ) {
      if (principal.chainId !== 97 || this.erc8183?.rpcUrl === undefined)
        throw new Error("BSC Testnet validation preflight is unavailable");
      const contract = getAddress(String(validationEvidence.contract));
      const args = validationEvidence.functionArguments as
        Record<string, unknown> | undefined;
      let data: `0x${string}`;
      let title: string;
      let action: string;
      let description: string;
      if (operation.operationType === "APPROVE_TOKEN") {
        if (
          args === undefined ||
          typeof args.spender !== "string" ||
          typeof args.amount !== "string"
        )
          throw new Error("Prepared token approval evidence is incomplete");
        data = encodeFunctionData({
          abi: erc20ApprovalAbi,
          functionName: "approve",
          args: [getAddress(args.spender), BigInt(args.amount)],
        });
        title = "Allow the exact service payment";
        action = "Approve payment";
        description =
          "Allow only this offer's exact token amount to be deposited into ERC-8183 escrow.";
      } else {
        const negotiatedAt = validationEvidence.negotiatedAt;
        const quoteExpiresAt = validationEvidence.quoteExpiresAt;
        if (
          args === undefined ||
          typeof args.provider !== "string" ||
          typeof args.evaluator !== "string" ||
          typeof args.expiredAt !== "string" ||
          typeof args.description !== "string" ||
          typeof args.hook !== "string" ||
          typeof negotiatedAt !== "number" ||
          typeof quoteExpiresAt !== "number" ||
          quoteExpiresAt - Math.floor(this.now().getTime() / 1_000) <
            USER_COMMERCE_CREATE_QUOTE_HEADROOM_SECONDS
        )
          throw new Error(
            "Prepared validation job evidence is incomplete or expired",
          );
        data = encodeFunctionData({
          abi: createJobAbi,
          functionName: "createJob",
          args: [
            getAddress(args.provider),
            getAddress(args.evaluator),
            BigInt(args.expiredAt),
            args.description,
            getAddress(args.hook),
          ],
        });
        title = "Start the validation job";
        action = "Create job";
        description =
          "Create the offer-bound ERC-8183 validation job. Funding remains a separate confirmation.";
      }
      if (
        keccak256(data).toLowerCase() !==
        operation.preparedPayloadHash.toLowerCase()
      )
        throw new Error("Prepared validation transaction hash mismatch");
      const publicClient = createPublicClient({
        chain: bscTestnet,
        transport: http(this.erc8183.rpcUrl),
      });
      await publicClient.call({
        account: principal.walletAddress,
        to: contract,
        data,
      });
      return {
        operationId: operation.id,
        operationType: operation.operationType as
          "APPROVE_TOKEN" | "CREATE_JOB",
        chainId: 97 as const,
        from: principal.walletAddress,
        to: contract,
        data,
        value: "0x0" as const,
        preparedPayloadHash: operation.preparedPayloadHash,
        presentation: {
          title,
          action,
          description,
          network: "BSC Testnet",
          servicePrice: displayServicePrice(agreement),
          fundsExpectedToMove: false,
        },
      };
    }
    if (
      agreement === null ||
      agreement.status !== "ACTIVE" ||
      operation === undefined ||
      operation.operationType !== "CREATE_JOB" ||
      operation.state !== "AWAITING_SIGNATURE" ||
      operation.transactionHash !== null ||
      operation.preparedPayloadHash === null ||
      operation.activationId === null ||
      operation.executionRequestId === null
    )
      throw new Error(
        "CREATE_JOB operation is not eligible for wallet submission",
      );
    const evidence = operation.evidence as Record<string, unknown>;
    const authorizationId = evidence.exactActionAuthorizationId;
    const actionHash = evidence.actionHash;
    const negotiatedAt = evidence.negotiatedAt;
    const quoteExpiresAt = evidence.quoteExpiresAt;
    const jobExpiresAt = evidence.jobExpiresAt;
    const args = evidence.functionArguments as
      Record<string, unknown> | undefined;
    if (
      typeof authorizationId !== "string" ||
      typeof actionHash !== "string" ||
      typeof negotiatedAt !== "number" ||
      !Number.isSafeInteger(negotiatedAt) ||
      typeof quoteExpiresAt !== "number" ||
      !Number.isSafeInteger(quoteExpiresAt) ||
      quoteExpiresAt <= negotiatedAt ||
      typeof jobExpiresAt !== "string" ||
      args === undefined ||
      typeof args.provider !== "string" ||
      typeof args.evaluator !== "string" ||
      typeof args.description !== "string" ||
      typeof args.hook !== "string" ||
      args.expiredAt !== jobExpiresAt
    )
      throw new Error("Prepared CREATE_JOB evidence is incomplete");
    const authorization = await this.store.authorizationArtifact(
      authorizationId,
      principal.principalId,
    );
    const nowSeconds = Math.floor(this.now().getTime() / 1_000);
    if (
      authorization === null ||
      authorization.verificationStatus !== "VERIFIED" ||
      authorization.revokedAt !== null ||
      authorization.expiresAt <= this.now() ||
      authorization.agreementId !== agreement.id ||
      authorization.executionRequestId !== operation.executionRequestId ||
      authorization.mandateId !== agreement.mandateId ||
      authorization.mandateVersion !== agreement.mandateVersion ||
      authorization.chainId !== 97 ||
      authorization.signerAddress === null ||
      getAddress(authorization.signerAddress) !== principal.walletAddress ||
      authorization.actionHash?.toLowerCase() !== actionHash.toLowerCase() ||
      quoteExpiresAt - negotiatedAt > SDK_MAX_SIGNED_QUOTE_TTL_SECONDS ||
      quoteExpiresAt - nowSeconds <
        USER_COMMERCE_CREATE_QUOTE_HEADROOM_SECONDS ||
      authorization.expiresAt.getTime() - this.now().getTime() <
        USER_COMMERCE_CREATE_QUOTE_HEADROOM_SECONDS * 1_000 ||
      BigInt(jobExpiresAt) <= BigInt(nowSeconds)
    )
      throw new Error("Authorization or seller quote is no longer current");
    const data = encodeFunctionData({
      abi: createJobAbi,
      functionName: "createJob",
      args: [
        getAddress(args.provider),
        getAddress(args.evaluator),
        BigInt(jobExpiresAt),
        args.description,
        getAddress(args.hook),
      ],
    });
    if (
      keccak256(data).toLowerCase() !==
      operation.preparedPayloadHash.toLowerCase()
    )
      throw new Error("Prepared CREATE_JOB payload hash mismatch");
    if (!args.description.includes(actionHash))
      throw new Error("Prepared job is not bound to the authorized action");
    return {
      operationId: operation.id,
      operationType: "CREATE_JOB" as const,
      chainId: 97 as const,
      from: principal.walletAddress,
      to: getAddress(String(evidence.contract)),
      data,
      value: "0x0" as const,
      actionHash,
      authorizationId,
      authorizationExpiresAt: authorization.expiresAt.toISOString(),
      quoteNegotiatedAt: new Date(negotiatedAt * 1_000).toISOString(),
      quoteExpiresAt: new Date(quoteExpiresAt * 1_000).toISOString(),
      quoteMinimumRemainingSeconds: USER_COMMERCE_CREATE_QUOTE_HEADROOM_SECONDS,
      jobExpiresAt: new Date(Number(jobExpiresAt) * 1_000).toISOString(),
      preparedPayloadHash: operation.preparedPayloadHash,
      presentation: {
        title: "Create the zero-price ERC-8183 job",
        action: "Create job",
        description:
          "Open one free ERC-8183 job for this approved action. This does not fund or settle it.",
        network: "BSC Testnet",
        servicePrice: "Free",
        fundsExpectedToMove: false,
      },
    };
  }

  private async preparedRegisterJobWalletTransaction(
    principal: WalletSessionPrincipal,
    agreementId: string,
    operationId: string,
  ) {
    if (
      principal.chainId !== 97 ||
      this.erc8183?.rpcUrl === undefined ||
      this.erc8183.policyAddress === undefined
    )
      throw new Error("BSC Testnet REGISTER_JOB preflight is unavailable");
    const agreement = await this.store.findAgreement(
      agreementId,
      principal.principalId,
    );
    const operation = agreement?.operations.find(
      (candidate) => candidate.id === operationId,
    );
    if (
      agreement === null ||
      agreement.status !== "ACTIVE" ||
      operation === undefined ||
      operation.operationType !== "REGISTER_JOB" ||
      operation.state !== "AWAITING_SIGNATURE" ||
      operation.transactionHash !== null ||
      operation.preparedPayloadHash === null ||
      operation.activationId === null
    )
      throw new Error(
        "REGISTER_JOB operation is not eligible for wallet submission",
      );
    const activation = await this.store.walletOperationActivation({
      activationId: operation.activationId,
      agreementId,
      principalId: principal.principalId,
    });
    if (
      activation === null ||
      !["USER_COMMERCE", "VERIFICATION"].includes(activation.purpose) ||
      activation.chainId !== 97 ||
      activation.lifecycleState !== "ONCHAIN_CREATED" ||
      activation.reconciliationState !== "CURRENT" ||
      activation.clientAddress === null ||
      getAddress(activation.clientAddress) !== principal.walletAddress ||
      activation.externalJobId === null
    )
      throw new Error("REGISTER_JOB activation is no longer current");
    const evidence = operation.evidence as Record<string, unknown>;
    const args = evidence.functionArguments as
      Record<string, unknown> | undefined;
    const jobIdValue = args?.jobId;
    const policyValue = args?.policy;
    if (
      (typeof jobIdValue !== "string" && typeof jobIdValue !== "number") ||
      typeof policyValue !== "string" ||
      typeof evidence.contract !== "string"
    )
      throw new Error("Prepared REGISTER_JOB evidence is incomplete");
    const jobId = BigInt(jobIdValue);
    const policy = getAddress(policyValue);
    const router = getAddress(this.erc8183.evaluatorAddress);
    if (
      activation.externalJobId !== jobId.toString() ||
      getAddress(evidence.contract) !== router ||
      policy !== getAddress(this.erc8183.policyAddress)
    )
      throw new Error("Prepared REGISTER_JOB binding does not match Relic");
    const data = encodeFunctionData({
      abi: registerJobAbi,
      functionName: "registerJob",
      args: [jobId, policy],
    });
    if (
      keccak256(data).toLowerCase() !==
      operation.preparedPayloadHash.toLowerCase()
    )
      throw new Error("Prepared REGISTER_JOB payload hash mismatch");
    const client = createPublicClient({
      chain: bscTestnet,
      transport: http(this.erc8183.rpcUrl),
    });
    const [job, currentPolicy, policyAllowed, policyCode] = await Promise.all([
      client.readContract({
        address: getAddress(this.erc8183.commerceAddress),
        abi: commerceJobAbi,
        functionName: "getJob",
        args: [jobId],
      }),
      client.readContract({
        address: router,
        abi: registerJobAbi,
        functionName: "jobPolicy",
        args: [jobId],
      }),
      client.readContract({
        address: router,
        abi: registerJobAbi,
        functionName: "policyWhitelist",
        args: [policy],
      }),
      client.getCode({ address: policy }),
    ]);
    const nowSeconds = BigInt(Math.floor(this.now().getTime() / 1_000));
    const quoteWindow = requireSignedQuoteHeadroom(
      job.description,
      "REGISTER_JOB",
      Number(nowSeconds),
    );
    if (
      job.id !== jobId ||
      job.status !== 0 ||
      job.budget !== 0n ||
      job.expiredAt <= nowSeconds ||
      getAddress(job.client) !== principal.walletAddress ||
      getAddress(job.evaluator) !== router ||
      getAddress(job.hook) !== router ||
      getAddress(currentPolicy) !== zeroAddress ||
      !policyAllowed ||
      policyCode === undefined ||
      policyCode === "0x"
    )
      throw new Error("Onchain job is not eligible for policy registration");
    await client.simulateContract({
      account: principal.walletAddress,
      address: router,
      abi: registerJobAbi,
      functionName: "registerJob",
      args: [jobId, policy],
    });
    return {
      operationId: operation.id,
      operationType: "REGISTER_JOB" as const,
      chainId: 97 as const,
      from: principal.walletAddress,
      to: router,
      data,
      value: "0x0" as const,
      preparedPayloadHash: operation.preparedPayloadHash,
      quoteNegotiatedAt: new Date(
        quoteWindow.negotiatedAt * 1_000,
      ).toISOString(),
      quoteExpiresAt: new Date(
        quoteWindow.quoteExpiresAt * 1_000,
      ).toISOString(),
      quoteMinimumRemainingSeconds: quoteWindow.requiredHeadroomSeconds,
      presentation: {
        title: "Complete service setup",
        action: "Register service policy",
        description:
          "Bind the approved dispute and evaluation policy to the existing ERC-8183 job.",
        network: "BSC Testnet",
        servicePrice: displayServicePrice(agreement),
        fundsExpectedToMove: false,
        jobId: jobId.toString(),
      },
    };
  }

  private async preparedSetBudgetWalletTransaction(
    principal: WalletSessionPrincipal,
    agreementId: string,
    operationId: string,
  ) {
    if (
      principal.chainId !== 97 ||
      this.erc8183?.rpcUrl === undefined ||
      this.erc8183.policyAddress === undefined
    )
      throw new Error("BSC Testnet SET_BUDGET preflight is unavailable");
    const agreement = await this.store.findAgreement(
      agreementId,
      principal.principalId,
    );
    const operation = agreement?.operations.find(
      (candidate) => candidate.id === operationId,
    );
    if (
      agreement === null ||
      agreement.status !== "ACTIVE" ||
      operation === undefined ||
      operation.operationType !== "SET_BUDGET" ||
      operation.state !== "AWAITING_SIGNATURE" ||
      operation.transactionHash !== null ||
      operation.preparedPayloadHash === null ||
      operation.activationId === null
    )
      throw new Error(
        "SET_BUDGET operation is not eligible for wallet submission",
      );
    const activation = await this.store.walletOperationActivation({
      activationId: operation.activationId,
      agreementId,
      principalId: principal.principalId,
    });
    if (
      activation === null ||
      !["USER_COMMERCE", "VERIFICATION"].includes(activation.purpose) ||
      activation.chainId !== 97 ||
      activation.lifecycleState !== "ONCHAIN_CREATED" ||
      activation.reconciliationState !== "CURRENT" ||
      activation.clientAddress === null ||
      getAddress(activation.clientAddress) !== principal.walletAddress ||
      activation.externalJobId === null
    )
      throw new Error("SET_BUDGET activation is no longer current");
    const evidence = operation.evidence as Record<string, unknown>;
    const args = evidence.functionArguments as
      Record<string, unknown> | undefined;
    const jobIdValue = args?.jobId;
    const amountValue = args?.amount;
    const optParamsValue = args?.optParams;
    if (
      (typeof jobIdValue !== "string" && typeof jobIdValue !== "number") ||
      (typeof amountValue !== "string" && typeof amountValue !== "number") ||
      typeof optParamsValue !== "string" ||
      !/^0x(?:[0-9a-fA-F]{2})*$/.test(optParamsValue) ||
      typeof evidence.contract !== "string" ||
      typeof evidence.calldata !== "string" ||
      !/^0x[0-9a-fA-F]+$/.test(evidence.calldata)
    )
      throw new Error("Prepared SET_BUDGET evidence is incomplete");
    const jobId = BigInt(jobIdValue);
    const amount = BigInt(amountValue);
    const commerce = getAddress(this.erc8183.commerceAddress);
    const expectedAmount = BigInt(activation.budgetBaseUnits ?? "0");
    if (
      activation.externalJobId !== jobId.toString() ||
      amount !== expectedAmount ||
      getAddress(evidence.contract) !== commerce
    )
      throw new Error("Prepared SET_BUDGET binding does not match Relic");
    const encodedData = encodeFunctionData({
      abi: commerceJobAbi,
      functionName: "setBudget",
      args: [jobId, amount, optParamsValue as `0x${string}`],
    });
    const data = evidence.calldata as `0x${string}`;
    if (
      encodedData.toLowerCase() !== data.toLowerCase() ||
      keccak256(data).toLowerCase() !==
        operation.preparedPayloadHash.toLowerCase()
    )
      throw new Error("Prepared SET_BUDGET payload hash mismatch");
    const client = createPublicClient({
      chain: bscTestnet,
      transport: http(this.erc8183.rpcUrl),
    });
    const router = getAddress(this.erc8183.evaluatorAddress);
    const expectedPolicy = getAddress(this.erc8183.policyAddress);
    const [job, hasBudget, currentPolicy] = await Promise.all([
      client.readContract({
        address: commerce,
        abi: commerceJobAbi,
        functionName: "getJob",
        args: [jobId],
      }),
      client.readContract({
        address: commerce,
        abi: commerceJobAbi,
        functionName: "jobHasBudget",
        args: [jobId],
      }),
      client.readContract({
        address: router,
        abi: registerJobAbi,
        functionName: "jobPolicy",
        args: [jobId],
      }),
    ]);
    const nowSeconds = BigInt(Math.floor(this.now().getTime() / 1_000));
    const quoteWindow = requireSignedQuoteHeadroom(
      job.description,
      "SET_BUDGET",
      Number(nowSeconds),
    );
    if (
      job.id !== jobId ||
      job.status !== 0 ||
      job.budget !== 0n ||
      hasBudget ||
      job.expiredAt <= nowSeconds ||
      getAddress(job.client) !== principal.walletAddress ||
      getAddress(job.evaluator) !== router ||
      getAddress(job.hook) !== router ||
      getAddress(currentPolicy) !== expectedPolicy
    )
      throw new Error("Onchain job is not eligible for budget setup");
    await client.simulateContract({
      account: principal.walletAddress,
      address: commerce,
      abi: commerceJobAbi,
      functionName: "setBudget",
      args: [jobId, amount, optParamsValue as `0x${string}`],
    });
    return {
      operationId: operation.id,
      operationType: "SET_BUDGET" as const,
      chainId: 97 as const,
      from: principal.walletAddress,
      to: commerce,
      data,
      value: "0x0" as const,
      preparedPayloadHash: operation.preparedPayloadHash,
      quoteNegotiatedAt: new Date(
        quoteWindow.negotiatedAt * 1_000,
      ).toISOString(),
      quoteExpiresAt: new Date(
        quoteWindow.quoteExpiresAt * 1_000,
      ).toISOString(),
      quoteMinimumRemainingSeconds: quoteWindow.requiredHeadroomSeconds,
      presentation: {
        title: "Set service budget",
        action: "Set service budget",
        description:
          "Set the exact offer-bound budget. This step does not transfer tokens.",
        network: "BSC Testnet",
        servicePrice: amount === 0n ? "Free" : displayServicePrice(agreement),
        fundsExpectedToMove: false,
        jobId: jobId.toString(),
        cost: "Gas only",
      },
    };
  }

  private async preparedFundWalletTransaction(
    principal: WalletSessionPrincipal,
    agreementId: string,
    operationId: string,
  ) {
    if (
      principal.chainId !== 97 ||
      this.erc8183?.rpcUrl === undefined ||
      this.erc8183.policyAddress === undefined
    )
      throw new Error("BSC Testnet FUND preflight is unavailable");
    const agreement = await this.store.findAgreement(
      agreementId,
      principal.principalId,
    );
    const operation = agreement?.operations.find(
      (candidate) => candidate.id === operationId,
    );
    if (
      agreement === null ||
      agreement.status !== "ACTIVE" ||
      operation === undefined ||
      operation.operationType !== "FUND" ||
      operation.state !== "AWAITING_SIGNATURE" ||
      operation.transactionHash !== null ||
      operation.preparedPayloadHash === null ||
      operation.activationId === null
    )
      throw new Error("FUND operation is not eligible for wallet submission");
    const activation = await this.store.walletOperationActivation({
      activationId: operation.activationId,
      agreementId,
      principalId: principal.principalId,
    });
    if (
      activation === null ||
      !["USER_COMMERCE", "VERIFICATION"].includes(activation.purpose) ||
      activation.chainId !== 97 ||
      activation.lifecycleState !== "ONCHAIN_CREATED" ||
      activation.reconciliationState !== "CURRENT" ||
      activation.clientAddress === null ||
      getAddress(activation.clientAddress) !== principal.walletAddress ||
      activation.externalJobId === null
    )
      throw new Error("FUND activation is no longer current");
    const evidence = operation.evidence as Record<string, unknown>;
    const args = evidence.functionArguments as
      Record<string, unknown> | undefined;
    const jobIdValue = args?.jobId;
    const expectedBudgetValue = args?.expectedBudget;
    const optParamsValue = args?.optParams;
    if (
      (typeof jobIdValue !== "string" && typeof jobIdValue !== "number") ||
      (typeof expectedBudgetValue !== "string" &&
        typeof expectedBudgetValue !== "number") ||
      typeof optParamsValue !== "string" ||
      !/^0x(?:[0-9a-fA-F]{2})*$/.test(optParamsValue) ||
      typeof evidence.contract !== "string" ||
      typeof evidence.calldata !== "string" ||
      !/^0x[0-9a-fA-F]+$/.test(evidence.calldata)
    )
      throw new Error("Prepared FUND evidence is incomplete");
    const jobId = BigInt(jobIdValue);
    const expectedBudget = BigInt(expectedBudgetValue);
    const commerce = getAddress(this.erc8183.commerceAddress);
    const expectedAmount = BigInt(activation.budgetBaseUnits ?? "0");
    if (
      activation.externalJobId !== jobId.toString() ||
      expectedBudget !== expectedAmount ||
      getAddress(evidence.contract) !== commerce
    )
      throw new Error("Prepared FUND binding does not match Relic");
    const encodedData = encodeFunctionData({
      abi: commerceJobAbi,
      functionName: "fund",
      args: [jobId, expectedBudget, optParamsValue as `0x${string}`],
    });
    const data = evidence.calldata as `0x${string}`;
    if (
      encodedData.toLowerCase() !== data.toLowerCase() ||
      keccak256(data).toLowerCase() !==
        operation.preparedPayloadHash.toLowerCase()
    )
      throw new Error("Prepared FUND payload hash mismatch");
    const client = createPublicClient({
      chain: bscTestnet,
      transport: http(this.erc8183.rpcUrl),
    });
    const router = getAddress(this.erc8183.evaluatorAddress);
    const expectedPolicy = getAddress(this.erc8183.policyAddress);
    const [job, hasBudget, currentPolicy] = await Promise.all([
      client.readContract({
        address: commerce,
        abi: commerceJobAbi,
        functionName: "getJob",
        args: [jobId],
      }),
      client.readContract({
        address: commerce,
        abi: commerceJobAbi,
        functionName: "jobHasBudget",
        args: [jobId],
      }),
      client.readContract({
        address: router,
        abi: registerJobAbi,
        functionName: "jobPolicy",
        args: [jobId],
      }),
    ]);
    const nowSeconds = BigInt(Math.floor(this.now().getTime() / 1_000));
    const quoteWindow = requireSignedQuoteHeadroom(
      job.description,
      "FUND",
      Number(nowSeconds),
    );
    if (
      job.id !== jobId ||
      job.status !== 0 ||
      job.budget !== expectedBudget ||
      !hasBudget ||
      job.expiredAt <= nowSeconds ||
      getAddress(job.client) !== principal.walletAddress ||
      getAddress(job.evaluator) !== router ||
      getAddress(job.hook) !== router ||
      getAddress(currentPolicy) !== expectedPolicy
    )
      throw new Error("Onchain job is not eligible for funding");
    await client.simulateContract({
      account: principal.walletAddress,
      address: commerce,
      abi: commerceJobAbi,
      functionName: "fund",
      args: [jobId, expectedBudget, optParamsValue as `0x${string}`],
    });
    return {
      operationId: operation.id,
      operationType: "FUND" as const,
      chainId: 97 as const,
      from: principal.walletAddress,
      to: commerce,
      data,
      value: "0x0" as const,
      preparedPayloadHash: operation.preparedPayloadHash,
      quoteNegotiatedAt: new Date(
        quoteWindow.negotiatedAt * 1_000,
      ).toISOString(),
      quoteExpiresAt: new Date(
        quoteWindow.quoteExpiresAt * 1_000,
      ).toISOString(),
      quoteMinimumRemainingSeconds: quoteWindow.requiredHeadroomSeconds,
      presentation: {
        title: expectedBudget === 0n ? "Confirm free service" : "Pay for service",
        action: expectedBudget === 0n ? "Confirm service" : "Pay service price",
        description:
          expectedBudget === 0n
            ? "Advance this free job to FUNDED with an explicit zero-value funding call. No tokens move."
            : "Deposit the exact approved offer amount into ERC-8183 escrow.",
        network: "BSC Testnet",
        servicePrice:
          expectedBudget === 0n
            ? "Free"
            : displayServicePrice(agreement),
        fundsExpectedToMove: expectedBudget > 0n,
        jobId: jobId.toString(),
        cost: expectedBudget === 0n ? "Gas only" : "Offer price plus gas",
      },
    };
  }

  public async refreshPreparedWalletTransaction(
    principal: WalletSessionPrincipal,
    agreementId: string,
    operationId: string,
  ) {
    const existingAgreement = await this.store.findAgreement(
      agreementId,
      principal.principalId,
    );
    const existingOperation = existingAgreement?.operations.find(
      ({ id }) => id === operationId,
    );
    const existingEvidence = existingOperation?.evidence as
      | Record<string, unknown>
      | undefined;
    // Quote-bound checkout operations use the current payment sequence. They
    // must not fall through to the retired zero-price CREATE_JOB refresh path.
    if (
      existingEvidence?.commerceValidation === true &&
      (existingOperation?.operationType === "APPROVE_TOKEN" ||
        existingOperation?.operationType === "CREATE_JOB")
    )
      return this.preparedWalletTransaction(principal, agreementId, operationId);
    if (existingOperation?.operationType === "REGISTER_JOB")
      return this.preparedRegisterJobWalletTransaction(
        principal,
        agreementId,
        operationId,
      );
    if (existingOperation?.operationType === "SET_BUDGET")
      return this.preparedSetBudgetWalletTransaction(
        principal,
        agreementId,
        operationId,
      );
    if (existingOperation?.operationType === "FUND")
      return this.preparedFundWalletTransaction(
        principal,
        agreementId,
        operationId,
      );
    if (
      this.erc8183?.rpcUrl === undefined ||
      this.erc8183.policyAddress === undefined
    )
      throw new Error("BSC Testnet transaction preflight is unavailable");
    const agreement = await this.store.findAgreement(
      agreementId,
      principal.principalId,
    );
    const operation = agreement?.operations.find(
      ({ id }) => id === operationId,
    );
    if (
      agreement === null ||
      agreement.status !== "ACTIVE" ||
      operation === undefined ||
      operation.state !== "AWAITING_SIGNATURE" ||
      operation.transactionHash !== null ||
      operation.preparedPayloadHash === null ||
      operation.executionRequestId === null
    )
      throw new Error("CREATE_JOB operation is not eligible for refresh");
    const evidence = operation.evidence as Record<string, unknown>;
    const authorizationId = evidence.exactActionAuthorizationId;
    const actionHash = evidence.actionHash;
    const monitoredAccount = evidence.monitoredAccount;
    if (
      typeof authorizationId !== "string" ||
      typeof actionHash !== "string" ||
      typeof monitoredAccount !== "string"
    )
      throw new Error("Exact-action preparation evidence is incomplete");
    if (
      principal.chainId !== 97 ||
      agreement.chainId !== 97 ||
      agreement.amountBaseUnits !== "0" ||
      operation.activationId === null
    )
      throw new Error(
        "CREATE_JOB is not an eligible zero-price BSC Testnet operation",
      );
    const context = await this.store.createJobSubmissionContext({
      activationId: operation.activationId,
      agreementId,
      principalId: principal.principalId,
    });
    const action =
      context === null
        ? null
        : (context.executionAction as Record<string, unknown>);
    const parameters =
      action === null
        ? null
        : (action.parameters as Record<string, unknown> | undefined);
    const verificationFreshAfter = new Date(
      this.now().getTime() - 7 * 86_400_000,
    );
    if (
      context === null ||
      context.activation.purpose !== "USER_COMMERCE" ||
      context.activation.lifecycleState !== "PREPARING" ||
      context.activation.reconciliationState !== "PENDING" ||
      context.activation.externalJobId !== null ||
      context.activation.authorizationId !== authorizationId ||
      context.activation.executionRequestId !== operation.executionRequestId ||
      context.activation.clientAddress?.toLowerCase() !==
        principal.walletAddress.toLowerCase() ||
      context.mandateStatus !== "ACTIVE" ||
      context.mandateCurrentVersion !== agreement.mandateVersion ||
      context.mandateActiveVersion !== agreement.mandateVersion ||
      context.serviceAvailability !== "available" ||
      context.serviceEndpoint === null ||
      !["INVOCATION_VERIFIED", "COMMERCE_VERIFIED"].includes(
        context.serviceVerificationLevel,
      ) ||
      context.serviceLastVerifiedAt === null ||
      context.serviceLastVerifiedAt <= verificationFreshAfter ||
      context.executionStatus !== "SUCCEEDED" ||
      context.executionHash.toLowerCase() !==
        actionHash.replace(/^0x/, "").toLowerCase() ||
      action?.chainId !== 97 ||
      action?.protocol !== "Venus" ||
      action?.actionType !== "observe_venus_position" ||
      action?.capability !== "monitor_positions" ||
      typeof parameters?.account !== "string" ||
      getAddress(parameters.account) !== getAddress(monitoredAccount)
    )
      throw new Error(
        "Mandate, service, activation, or canonical action is no longer eligible",
      );
    const authorization = await this.store.authorizationArtifact(
      authorizationId,
      principal.principalId,
    );
    const minimumExpiry = new Date(
      this.now().getTime() +
        USER_COMMERCE_CREATE_QUOTE_HEADROOM_SECONDS * 1_000,
    );
    if (
      authorization === null ||
      authorization.verificationStatus !== "VERIFIED" ||
      authorization.revokedAt !== null ||
      authorization.expiresAt <= minimumExpiry ||
      authorization.actionHash?.toLowerCase() !== actionHash.toLowerCase() ||
      authorization.executionRequestId !== operation.executionRequestId ||
      authorization.signerAddress === null ||
      getAddress(authorization.signerAddress) !== principal.walletAddress
    )
      throw new Error("A fresh exact-action buyer authorization is required");
    const client = createPublicClient({
      chain: bscTestnet,
      transport: http(this.erc8183.rpcUrl),
    });
    const policy = getAddress(this.erc8183.policyAddress);
    const router = getAddress(this.erc8183.evaluatorAddress);
    const [
      connectedChainId,
      buyerBalance,
      gasPrice,
      policyAllowed,
      policyCode,
      disputeWindow,
    ] = await Promise.all([
      client.getChainId(),
      client.getBalance({ address: principal.walletAddress }),
      client.getGasPrice(),
      client.readContract({
        address: router,
        abi: registerJobAbi,
        functionName: "policyWhitelist",
        args: [policy],
      }),
      client.getCode({ address: policy }),
      client.readContract({
        address: policy,
        abi: policyReadinessAbi,
        functionName: "disputeWindow",
      }),
    ]);
    const requiredGasBalance = activationSetupRequiredGasBalance(gasPrice);
    if (
      connectedChainId !== 97 ||
      !policyAllowed ||
      policyCode === undefined ||
      policyCode === "0x" ||
      disputeWindow <= 0n ||
      buyerBalance < requiredGasBalance
    )
      throw new Error(
        "Activation setup is not ready before seller negotiation: verify chain, policy, and buyer testnet gas balance",
      );
    const endpoint = context.serviceEndpoint;
    const base = endpoint.replace(/\/$/, "");
    const request = {
      task_description: JSON.stringify({
        account: getAddress(monitoredAccount),
        protocol: "venus-core",
        chainId: 97,
        actionHash,
      }),
      terms: {
        deliverables: "Relic health-factor analysis schema v1.0 JSON",
        quality_standards:
          "Read-only Venus evidence with chain and observed block",
        success_criteria: ["source is onchain", "readOnly is true"],
        price: "0",
      },
    };
    const [statusResponse, quoteResponse] = await Promise.all([
      fetch(`${base}/status`, { signal: AbortSignal.timeout(10_000) }),
      fetch(`${base}/negotiate`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(request),
        signal: AbortSignal.timeout(10_000),
      }),
    ]);
    if (!statusResponse.ok || !quoteResponse.ok)
      throw new Error("Seller negotiation is unavailable");
    const status = (await statusResponse.json()) as Record<string, unknown>;
    const quote = (await quoteResponse.json()) as Record<string, unknown>;
    const response = quote.response as Record<string, unknown> | undefined;
    const responseTerms = response?.terms as
      Record<string, unknown> | undefined;
    if (
      status.chain_id !== 97 ||
      getAddress(String(status.agent_address)) !==
        getAddress(
          String(
            evidence.functionArguments &&
              (evidence.functionArguments as Record<string, unknown>).provider,
          ),
        ) ||
      response?.accepted !== true ||
      responseTerms?.price !== "0" ||
      quote.chain_id !== 97 ||
      getAddress(String(quote.verifying_contract)) !==
        getAddress(this.erc8183.commerceAddress)
    )
      throw new Error("Seller quote does not match the authorized job");
    const quoteExpiresAt = response.quote_expires_at;
    const negotiatedAt = response.negotiated_at;
    const negotiationHash = quote.negotiation_hash;
    const providerSignature = quote.provider_sig;
    if (
      typeof negotiatedAt !== "number" ||
      !Number.isSafeInteger(negotiatedAt) ||
      typeof quoteExpiresAt !== "number" ||
      !Number.isSafeInteger(quoteExpiresAt) ||
      quoteExpiresAt <= negotiatedAt ||
      quoteExpiresAt - negotiatedAt > SDK_MAX_SIGNED_QUOTE_TTL_SECONDS ||
      quoteExpiresAt - Math.floor(this.now().getTime() / 1_000) <
        USER_COMMERCE_CREATE_QUOTE_HEADROOM_SECONDS ||
      typeof negotiationHash !== "string" ||
      typeof providerSignature !== "string"
    )
      throw new Error("Seller quote lacks safe submission headroom");
    const terms = {
      deliverables: sanitizeClaim(responseTerms.deliverables),
      quality_standards: sanitizeClaim(responseTerms.quality_standards),
      ...(Array.isArray(responseTerms.success_criteria)
        ? {
            success_criteria: responseTerms.success_criteria.map(sanitizeClaim),
          }
        : {}),
    };
    const signedContent = {
      version: 1,
      negotiated_at: negotiatedAt,
      task: sanitizeClaim(request.task_description),
      terms,
      price: "0",
      currency: String(responseTerms.currency),
      quote_expires_at: quoteExpiresAt,
      chain_id: 97,
      verifying_contract: getAddress(this.erc8183.commerceAddress),
    };
    const recomputedHash = keccak256(stringToHex(canonicalJson(signedContent)));
    if (recomputedHash.toLowerCase() !== negotiationHash.toLowerCase())
      throw new Error("Seller negotiation hash mismatch");
    const recovered = await recoverMessageAddress({
      message: negotiationHash,
      signature: providerSignature as `0x${string}`,
    });
    const provider = getAddress(String(status.agent_address));
    if (recovered !== provider) throw new Error("Seller signature is invalid");
    const jobExpiresAt =
      BigInt(Math.floor(this.now().getTime() / 1_000)) +
      disputeWindow +
      USER_COMMERCE_JOB_LIFETIME_SECONDS;
    const description = canonicalJson({
      ...signedContent,
      negotiation_hash: negotiationHash,
      provider_sig: providerSignature,
    });
    if (
      !description.includes(monitoredAccount) ||
      !description.includes(actionHash)
    )
      throw new Error("Fresh job description is not action-bound");
    const args = [
      provider,
      getAddress(this.erc8183.evaluatorAddress),
      jobExpiresAt,
      description,
      getAddress(this.erc8183.evaluatorAddress),
    ] as const;
    const data = encodeFunctionData({
      abi: createJobAbi,
      functionName: "createJob",
      args,
    });
    const preparedPayloadHash = keccak256(data);
    const gasEstimate = await client.estimateContractGas({
      address: this.erc8183.commerceAddress,
      abi: createJobAbi,
      functionName: "createJob",
      args,
      account: principal.walletAddress,
    });
    const preparationHistory: unknown[] = Array.isArray(
      evidence.preparationHistory,
    )
      ? [...(evidence.preparationHistory as unknown[])]
      : [];
    await this.store.refreshPreparedWalletOperation({
      operationId,
      agreementId,
      principalId: principal.principalId,
      previousPayloadHash: operation.preparedPayloadHash,
      preparedPayloadHash,
      evidence: {
        ...evidence,
        preparationHistory: [
          ...preparationHistory,
          {
            preparedPayloadHash: operation.preparedPayloadHash,
            supersededAt: this.now().toISOString(),
            reason: "just-in-time-wallet-preflight",
            quoteExpiresAt:
              typeof evidence.quoteExpiresAt === "number"
                ? evidence.quoteExpiresAt
                : null,
            negotiatedAt:
              typeof evidence.negotiatedAt === "number"
                ? evidence.negotiatedAt
                : null,
            negotiationHash:
              typeof evidence.negotiationHash === "string"
                ? evidence.negotiationHash
                : null,
            jobExpiresAt:
              typeof evidence.jobExpiresAt === "string"
                ? evidence.jobExpiresAt
                : null,
            exactActionAuthorizationId: authorizationId,
          },
        ],
        negotiatedAt,
        quoteExpiresAt,
        jobExpiresAt: jobExpiresAt.toString(),
        negotiationHash,
        preparedPayloadHash,
        functionArguments: {
          provider,
          evaluator: this.erc8183.evaluatorAddress,
          expiredAt: jobExpiresAt.toString(),
          description,
          hook: this.erc8183.evaluatorAddress,
        },
        gasEstimate: gasEstimate.toString(),
        expectedGasPrice: gasPrice.toString(),
        setupGasReserveUnits: USER_COMMERCE_SETUP_GAS_RESERVE_UNITS.toString(),
        requiredGasBalance: requiredGasBalance.toString(),
        observedBuyerBalance: buyerBalance.toString(),
        policyReady: true,
        supportedWalletOperations: [
          "CREATE_JOB",
          "REGISTER_JOB",
          "SET_BUDGET",
          "FUND",
        ],
        refreshedAt: this.now().toISOString(),
      },
    });
    return this.preparedWalletTransaction(principal, agreementId, operationId);
  }

  public async recordWalletSubmission(
    principal: WalletSessionPrincipal,
    agreementId: string,
    operationId: string,
    transactionHash: string,
    signerAddress: string,
    preparedPayloadHash: string,
    nonce?: bigint,
  ) {
    if (
      principal.chainId !== 97 ||
      getAddress(signerAddress) !== principal.walletAddress
    )
      throw new Error("Wallet submission signer does not match the buyer");
    const operation = await this.store.recordWalletSubmittedOperation({
      operationId,
      agreementId,
      principalId: principal.principalId,
      transactionHash,
      signerAddress: principal.walletAddress,
      preparedPayloadHash,
      ...(nonce === undefined ? {} : { nonce }),
    });
    return {
      ...operation,
      nonce: operation.nonce?.toString() ?? null,
      blockNumber: operation.blockNumber?.toString() ?? null,
    };
  }

  public acceptTerms(
    principal: WalletSessionPrincipal,
    agreementId: string,
    termsHash: string,
  ) {
    return this.store.acceptTerms({
      agreementId,
      principalId: principal.principalId,
      termsHash,
    });
  }

  public cancelAgreement(
    principal: WalletSessionPrincipal,
    agreementId: string,
  ) {
    return this.store.cancelAgreement({
      agreementId,
      principalId: principal.principalId,
    });
  }

  public revokeAuthorization(
    principal: WalletSessionPrincipal,
    agreementId: string,
  ) {
    return this.store.revokeAuthorization({
      agreementId,
      principalId: principal.principalId,
    });
  }

  public async createActivation(
    principal: WalletSessionPrincipal,
    agreementId: string,
    executionRequestId: string,
    authorizationId: string,
  ) {
    if (this.erc8183 === undefined)
      throw new Error("ERC-8183 activation configuration is unavailable");
    const authorization = await this.store.authorizationArtifact(
      authorizationId,
      principal.principalId,
    );
    const minimumExpiry = new Date(
      this.now().getTime() +
        USER_COMMERCE_CREATE_QUOTE_HEADROOM_SECONDS * 1_000,
    );
    if (
      authorization === null ||
      authorization.verificationStatus !== "VERIFIED" ||
      authorization.revokedAt !== null ||
      authorization.expiresAt <= minimumExpiry ||
      authorization.executionRequestId !== executionRequestId ||
      authorization.signerAddress === null ||
      getAddress(authorization.signerAddress) !== principal.walletAddress
    )
      throw new Error(
        "A fresh exact-action buyer authorization with setup headroom is required",
      );
    return this.store.createUserCommerceActivation({
      agreementId,
      executionRequestId,
      authorizationId,
      commerceAddress: this.erc8183.commerceAddress,
      clientAddress: principal.walletAddress,
      evaluatorAddress: this.erc8183.evaluatorAddress,
    });
  }

  public async authorizationChallenge(
    principal: WalletSessionPrincipal,
    agreementId: string,
    actionHash: `0x${string}` | null,
  ) {
    const agreement = await this.store.findAgreement(
      agreementId,
      principal.principalId,
    );
    if (
      agreement === null ||
      agreement.mandateId === null ||
      agreement.mandateVersion === null
    )
      throw new Error("Agreement is not ready for authorization");
    if (agreement.chainId !== principal.chainId)
      throw new Error("Wallet session network does not match the agreement");
    const nonce = randomBytes(32).toString("hex");
    const expiresAt = new Date(
      this.now().getTime() + (actionHash === null ? 10 : 60) * 60_000,
    );
    const authorization: CommerceAuthorization = {
      agreementId: agreement.id,
      principal: principal.walletAddress,
      agentId: agreement.agentId,
      mandateId: agreement.mandateId,
      mandateVersion: agreement.mandateVersion,
      offerVersionId: agreement.offerVersionId,
      termsHash: agreement.termsHash,
      actionHash,
      tokenAddress: getAddress(agreement.paymentTokenAddress),
      amountBaseUnits: agreement.amountBaseUnits,
      chainId: agreement.chainId as 56 | 97,
      nonce,
      expiresAt: Math.floor(expiresAt.getTime() / 1_000).toString(),
    };
    const nonceHash = sha256(nonce);
    const challenge = await this.store.createAuthorizationChallenge({
      agreementId,
      principalId: principal.principalId,
      nonceHash,
      normalizedPayload: authorization,
      expiresAt,
    });
    const typedData = commerceAuthorizationTypedData(
      authorization,
      this.verifyingContract,
    );
    return {
      challengeId: challenge.id,
      authorization,
      typedData: {
        ...typedData,
        message: {
          ...typedData.message,
          mandateVersion: typedData.message.mandateVersion.toString(),
          amountBaseUnits: typedData.message.amountBaseUnits.toString(),
          expiresAt: typedData.message.expiresAt.toString(),
        },
      },
      expiresAt: expiresAt.toISOString(),
    };
  }

  public async verifyAuthorization(
    principal: WalletSessionPrincipal,
    agreementId: string,
    challengeId: string,
    signature: `0x${string}`,
  ) {
    const challenge = await this.store.authorizationChallenge(
      challengeId,
      principal.principalId,
    );
    if (
      challenge === null ||
      challenge.consumedAt !== null ||
      challenge.expiresAt <= this.now()
    )
      throw new Error("Authorization challenge is invalid or expired");
    const authorization = commerceAuthorizationSchema.parse(
      challenge.normalizedPayload,
    );
    if (
      authorization.agreementId !== agreementId ||
      getAddress(authorization.principal) !== principal.walletAddress ||
      authorization.chainId !== principal.chainId
    )
      throw new Error(
        "Authorization agreement, signer, or network does not match session",
      );
    const recovered =
      authorization.actionHash === null
        ? await recoverTypedDataAddress({
            ...agreementAuthorizationTypedData(
              authorization,
              this.verifyingContract,
            ),
            signature,
          })
        : await recoverTypedDataAddress({
            ...executionApprovalTypedData(
              {
                ...authorization,
                actionHash: authorization.actionHash as `0x${string}`,
              },
              this.verifyingContract,
            ),
            signature,
          });
    if (getAddress(recovered) !== principal.walletAddress)
      throw new Error("Commerce authorization signer does not match");
    const nonceHash = sha256(authorization.nonce);
    const consumed = await this.store.consumeAuthorizationChallenge({
      id: challenge.id,
      principalId: principal.principalId,
      nonceHash,
      now: this.now(),
    });
    if (consumed === null)
      throw new Error("Commerce authorization replay detected");
    const messageHash =
      authorization.actionHash === null
        ? hashTypedData(
            agreementAuthorizationTypedData(
              authorization,
              this.verifyingContract,
            ),
          )
        : hashTypedData(
            executionApprovalTypedData(
              {
                ...authorization,
                actionHash: authorization.actionHash as `0x${string}`,
              },
              this.verifyingContract,
            ),
          );
    return this.store.recordAuthorization({
      principalId: principal.principalId,
      signerAddress: principal.walletAddress,
      authorization,
      signature,
      messageHash,
      nonceHash,
      evidenceReference: {
        source: "eip712-recovery",
        challengeId,
        sessionId: principal.sessionId,
        verifyingContract: this.verifyingContract,
      },
    });
  }
}
