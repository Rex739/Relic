/* eslint-disable @typescript-eslint/require-await */
import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

import { agreementAuthorizationTypedData } from "@relic/domain";

import {
  CommerceApplicationService,
  principalIdForWallet,
  WalletAuthenticationService,
} from "../src/commerce.js";

const account = privateKeyToAccount(
  "0x1111111111111111111111111111111111111111111111111111111111111111",
);
const now = new Date("2026-08-22T00:00:00.000Z");

class MemoryWalletStore {
  challenge: Record<string, unknown> | null = null;
  consumed = false;
  sessionRow: Record<string, unknown> | null = null;

  async createChallenge(input: Record<string, unknown>) {
    this.challenge = {
      id: "01945b1e-7e80-7000-8000-000000000001",
      consumedAt: null,
      ...input,
    };
    return this.challenge.id as string;
  }
  async findChallenge() {
    return this.challenge;
  }
  async consumeChallenge() {
    if (this.consumed) return null;
    this.consumed = true;
    return this.challenge;
  }
  async createSession(input: Record<string, unknown>) {
    this.sessionRow = {
      id: "01945b1e-7e80-7000-8000-000000000002",
      revokedAt: null,
      ...input,
    };
    return this.sessionRow.id as string;
  }
  async session() {
    return this.sessionRow;
  }
  async revokeSession() {
    return true;
  }
}

describe("production wallet authentication", () => {
  it("recovers the signer and consumes a one-time challenge", async () => {
    const store = new MemoryWalletStore();
    const service = new WalletAuthenticationService(
      store as never,
      "relic.example",
      "https://relic.example",
      () => now,
    );
    const challenge = await service.challenge(account.address, 97);
    const signature = await account.signMessage({ message: challenge.message });
    const verified = await service.verify({
      challengeId: challenge.id,
      address: account.address,
      chainId: 97,
      signature,
    });
    expect(verified.principal).toMatchObject({
      walletAddress: account.address,
      chainId: 97,
      principalId: principalIdForWallet(account.address, 97),
    });
    await expect(
      service.verify({
        challengeId: challenge.id,
        address: account.address,
        chainId: 97,
        signature,
      }),
    ).rejects.toThrow(/already used|replay/i);
  });

  it("rejects the wrong network before session creation", async () => {
    const store = new MemoryWalletStore();
    const service = new WalletAuthenticationService(
      store as never,
      "relic.example",
      "https://relic.example",
      () => now,
    );
    const challenge = await service.challenge(account.address, 97);
    const signature = await account.signMessage({ message: challenge.message });
    await expect(
      service.verify({
        challengeId: challenge.id,
        address: account.address,
        chainId: 56,
        signature,
      }),
    ).rejects.toThrow(/invalid|expired/i);
  });
});

class MemoryCommerceStore {
  challenge: Record<string, unknown> | null = null;
  consumed = false;
  authorization: Record<string, unknown> | null = null;
  readonly agreement = {
    id: "01945b1e-7e80-7000-8000-000000000010",
    principalId: principalIdForWallet(account.address, 97),
    agentId: "01945b1e-7e80-7000-8000-000000000011",
    mandateId: "01945b1e-7e80-7000-8000-000000000012",
    mandateVersion: 2,
    offerVersionId: "01945b1e-7e80-7000-8000-000000000013",
    termsHash:
      "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    paymentTokenAddress: "0x0000000000000000000000000000000000000000",
    paymentTokenDecimals: 18,
    amountBaseUnits: "0",
    chainId: 97,
    status: "AUTHORIZATION_REQUIRED",
  };
  async findAgreement() {
    return this.agreement;
  }
  async createAuthorizationChallenge(input: Record<string, unknown>) {
    this.challenge = {
      id: "01945b1e-7e80-7000-8000-000000000014",
      consumedAt: null,
      ...input,
    };
    return this.challenge;
  }
  async authorizationChallenge() {
    return this.challenge;
  }
  async consumeAuthorizationChallenge() {
    if (this.consumed) return null;
    this.consumed = true;
    return this.challenge;
  }
  async recordAuthorization(input: Record<string, unknown>) {
    this.authorization = input;
    return { artifactId: "01945b1e-7e80-7000-8000-000000000015" };
  }
}

describe("EIP-712 commerce authorization", () => {
  it("binds signature to agreement, terms, amount, chain, and one-time nonce", async () => {
    const store = new MemoryCommerceStore();
    const contract = "0x3333333333333333333333333333333333333333" as const;
    const service = new CommerceApplicationService(
      store as never,
      contract,
      () => now,
    );
    const principal = {
      principalId: store.agreement.principalId,
      walletAddress: account.address,
      chainId: 97,
      sessionId: "01945b1e-7e80-7000-8000-000000000020",
    };
    const challenge = await service.authorizationChallenge(
      principal,
      store.agreement.id,
      null,
    );
    const signature = await account.signTypedData(
      agreementAuthorizationTypedData(challenge.authorization, contract),
    );
    await expect(
      service.verifyAuthorization(
        principal,
        store.agreement.id,
        challenge.challengeId,
        signature,
      ),
    ).resolves.toHaveProperty("artifactId");
    await expect(
      service.verifyAuthorization(
        principal,
        store.agreement.id,
        challenge.challengeId,
        signature,
      ),
    ).rejects.toThrow(/already|invalid|expired|replay/i);
  });

  it("rejects a signature replayed against another agreement route", async () => {
    const store = new MemoryCommerceStore();
    const contract = "0x3333333333333333333333333333333333333333" as const;
    const service = new CommerceApplicationService(
      store as never,
      contract,
      () => now,
    );
    const principal = {
      principalId: store.agreement.principalId,
      walletAddress: account.address,
      chainId: 97,
      sessionId: "01945b1e-7e80-7000-8000-000000000020",
    };
    const challenge = await service.authorizationChallenge(
      principal,
      store.agreement.id,
      null,
    );
    const signature = await account.signTypedData(
      agreementAuthorizationTypedData(challenge.authorization, contract),
    );
    await expect(
      service.verifyAuthorization(
        principal,
        "01945b1e-7e80-7000-8000-000000000099",
        challenge.challengeId,
        signature,
      ),
    ).rejects.toThrow(/agreement/i);
  });
});
