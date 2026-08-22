import { createHash, randomBytes } from "node:crypto";

import type { CommerceAuthorization, CreateOfferRequest } from "@relic/domain";
import {
  agreementAuthorizationTypedData,
  commerceAuthorizationSchema,
  commerceAuthorizationTypedData,
  executionApprovalTypedData,
} from "@relic/domain";
import type {
  DrizzleCommerceStore,
  DrizzleWalletAuthStore,
} from "@relic/database";
import {
  getAddress,
  hashTypedData,
  recoverMessageAddress,
  recoverTypedDataAddress,
} from "viem";

const sha256 = (value: string) =>
  createHash("sha256").update(value).digest("hex");

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
    },
  ) {}

  public createOffer(
    principal: WalletSessionPrincipal,
    request: CreateOfferRequest,
  ) {
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

  public hire(
    principal: WalletSessionPrincipal,
    offerId: string,
    mandateId: string,
  ) {
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

  public createActivation(
    principal: WalletSessionPrincipal,
    agreementId: string,
    executionRequestId: string,
    authorizationId: string,
  ) {
    if (this.erc8183 === undefined)
      throw new Error("ERC-8183 activation configuration is unavailable");
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
    const expiresAt = new Date(this.now().getTime() + 10 * 60_000);
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
