import { createHash, randomBytes } from "node:crypto";

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
  executionApprovalTypedData,
  isMarketplaceReviewTag,
  MandateValidationError,
} from "@relic/domain";
import type {
  DrizzleCommerceStore,
  DrizzleWalletAuthStore,
} from "@relic/database";
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
export const SDK_MAX_SIGNED_QUOTE_TTL_SECONDS = 900;
export const USER_COMMERCE_CREATE_QUOTE_HEADROOM_SECONDS = 12 * 60;
export const USER_COMMERCE_SETUP_GAS_RESERVE_UNITS = 2_000_000n;
export const activationSetupRequiredGasBalance = (gasPrice: bigint) =>
  gasPrice * USER_COMMERCE_SETUP_GAS_RESERVE_UNITS;
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
    const sessionToken = randomBytes(48).toString("base64url");
    const expiresAt = new Date(this.now().getTime() + 8 * 60 * 60_000);
    const principalId = principalIdForWallet(address, input.chainId);
    const sessionId = await this.store.createSession({
      principalId,
      walletAddress: address,
      chainId: input.chainId,
      sessionTokenHash: sha256(sessionToken),
      expiresAt,
    });
    return {
      sessionToken,
      principal: {
        principalId,
        walletAddress: address,
        chainId: input.chainId,
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

  public createOffer(
    principal: WalletSessionPrincipal,
    request: CreateOfferRequest,
  ) {
    if (principal.chainId !== request.chainId)
      throw new Error("Wallet session network does not match the offer");
    return this.store.createOffer({
      operatorPrincipalId: principal.principalId,
      operatorAddress: principal.walletAddress,
      request,
    });
  }

  public activateOffer(principal: WalletSessionPrincipal, offerId: string) {
    return this.store.activateOffer({
      offerId,
      operatorPrincipalId: principal.principalId,
      operatorAddress: principal.walletAddress,
    });
  }

  public transitionOffer(
    principal: WalletSessionPrincipal,
    offerId: string,
    to: "PAUSED" | "DEACTIVATED",
  ) {
    return this.store.transitionOffer({
      offerId,
      operatorPrincipalId: principal.principalId,
      to,
    });
  }

  public reviseOffer(
    principal: WalletSessionPrincipal,
    offerId: string,
    request: CreateOfferRequest,
  ) {
    if (principal.chainId !== request.chainId)
      throw new Error("Wallet session network does not match the offer");
    return this.store.reviseOffer({
      offerId,
      operatorPrincipalId: principal.principalId,
      operatorAddress: principal.walletAddress,
      request,
    });
  }

  public operatorOffers(principal: WalletSessionPrincipal) {
    return this.store.operatorOffers(principal.principalId);
  }

  public operatorAgreements(principal: WalletSessionPrincipal) {
    return this.store.operatorAgreements(principal.principalId);
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
    if (
      !args.description.includes(actionHash) ||
      !args.description.includes("0x2A1317EC5fb5557A4cAd0B97fd851630aD8EDA87")
    )
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
      activation.purpose !== "USER_COMMERCE" ||
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
        title: "Register job policy",
        action: "Register policy",
        description:
          "Bind the approved dispute and evaluation policy to the existing ERC-8183 job.",
        network: "BSC Testnet",
        servicePrice: "Free",
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
      activation.purpose !== "USER_COMMERCE" ||
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
    if (
      activation.externalJobId !== jobId.toString() ||
      amount !== 0n ||
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
      throw new Error("Onchain job is not eligible for zero-budget setup");
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
        title: "Set job budget",
        action: "Set budget",
        description:
          "Explicitly initialize this free job's zero budget. This is not funding and moves no tokens.",
        network: "BSC Testnet",
        servicePrice: "Free / 0",
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
      activation.purpose !== "USER_COMMERCE" ||
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
    if (
      activation.externalJobId !== jobId.toString() ||
      expectedBudget !== 0n ||
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
      job.budget !== 0n ||
      !hasBudget ||
      job.expiredAt <= nowSeconds ||
      getAddress(job.client) !== principal.walletAddress ||
      getAddress(job.evaluator) !== router ||
      getAddress(job.hook) !== router ||
      getAddress(currentPolicy) !== expectedPolicy
    )
      throw new Error("Onchain job is not eligible for zero-value funding");
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
        title: "Fund free job",
        action: "Fund job",
        description:
          "Advance this free job to FUNDED with an explicit zero-value funding call. No tokens move.",
        network: "BSC Testnet",
        servicePrice: "Free / 0",
        fundsExpectedToMove: false,
        jobId: jobId.toString(),
        cost: "Gas only",
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
