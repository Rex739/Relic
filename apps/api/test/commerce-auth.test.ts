/* eslint-disable @typescript-eslint/require-await */
import { encodeFunctionData, encodeFunctionResult, keccak256 } from "viem";
import { afterEach, describe, expect, it, vi } from "vitest";
import { privateKeyToAccount } from "viem/accounts";

import {
  agreementAuthorizationTypedData,
  executionApprovalTypedData,
} from "@relic/domain";

import {
  activationSetupRequiredGasBalance,
  CommerceApplicationService,
  principalIdForWallet,
  WalletAuthenticationService,
} from "../src/commerce.js";

const account = privateKeyToAccount(
  "0x1111111111111111111111111111111111111111111111111111111111111111",
);
const otherAccount = privateKeyToAccount(
  "0x2222222222222222222222222222222222222222222222222222222222222222",
);
const now = new Date("2026-08-22T00:00:00.000Z");

describe("activation setup readiness", () => {
  it("reserves gas for all four manual setup transactions before requesting a quote", () => {
    expect(activationSetupRequiredGasBalance(1_000_000_000n)).toBe(
      2_000_000_000_000_000n,
    );
  });
});

class MemoryWalletStore {
  challenge: Record<string, unknown> | null = null;
  consumed = false;
  sessionRow: Record<string, unknown> | null = null;
  revoked = false;

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
  async session(sessionTokenHash: string) {
    return !this.revoked &&
      this.sessionRow?.sessionTokenHash === sessionTokenHash
      ? this.sessionRow
      : null;
  }
  async revokeSession(sessionTokenHash: string) {
    if (this.sessionRow?.sessionTokenHash !== sessionTokenHash) return false;
    this.revoked = true;
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

  it("scopes sessions to an unguessable token and invalidates them on logout", async () => {
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
    await expect(
      service.session("different-session-token"),
    ).resolves.toBeNull();
    await expect(service.session(verified.sessionToken)).resolves.toMatchObject(
      {
        walletAddress: account.address,
        chainId: 97,
      },
    );
    await expect(service.revoke(verified.sessionToken)).resolves.toBe(true);
    await expect(service.session(verified.sessionToken)).resolves.toBeNull();
  });

  it("rejects a challenge signed by a different wallet", async () => {
    const store = new MemoryWalletStore();
    const service = new WalletAuthenticationService(
      store as never,
      "relic.example",
      "https://relic.example",
      () => now,
    );
    const challenge = await service.challenge(account.address, 97);
    const signature = await otherAccount.signMessage({
      message: challenge.message,
    });
    await expect(
      service.verify({
        challengeId: challenge.id,
        address: account.address,
        chainId: 97,
        signature,
      }),
    ).rejects.toThrow(/signer/i);
  });
});

describe("verified marketplace review authorization", () => {
  const principal = {
    principalId: principalIdForWallet(account.address, 97),
    walletAddress: account.address,
    chainId: 97,
    sessionId: "01945b1e-7e80-7000-8000-000000000090",
  };

  it("rejects tags outside the authoritative role and sentiment vocabulary", async () => {
    const store = { marketplaceReviewEligibility: vi.fn() };
    const service = new CommerceApplicationService(
      store as never,
      account.address,
    );
    await expect(
      service.createMarketplaceReview(principal, {
        activationId: "01945b1e-7e80-7000-8000-000000000091",
        reviewerRole: "BUYER",
        sentiment: "GOOD",
        tags: ["did-not-work"],
        message: null,
      }),
    ).rejects.toThrow(/tags/i);
    expect(store.marketplaceReviewEligibility).not.toHaveBeenCalled();
  });

  it("derives the agent subject from persisted eligible marketplace work", async () => {
    const createMarketplaceReview = vi.fn((input) => Promise.resolve(input));
    const store = {
      marketplaceReviewEligibility: () =>
        Promise.resolve({
          eligible: true,
          reason: "eligible",
          reviewerRole: "BUYER",
          subjectType: "AGENT",
          activationId: "01945b1e-7e80-7000-8000-000000000091",
          agreementId: "01945b1e-7e80-7000-8000-000000000092",
          agentId: "01945b1e-7e80-7000-8000-000000000093",
          buyerPrincipalId: principal.principalId,
          existingReviewId: null,
        }),
      createMarketplaceReview,
    };
    const service = new CommerceApplicationService(
      store as never,
      account.address,
    );
    await service.createMarketplaceReview(principal, {
      activationId: "01945b1e-7e80-7000-8000-000000000091",
      reviewerRole: "BUYER",
      sentiment: "GOOD",
      tags: ["reliable"],
      message: " Reliable result. ",
    });
    expect(createMarketplaceReview).toHaveBeenCalledWith(
      expect.objectContaining({
        subjectType: "AGENT",
        subjectAgentId: "01945b1e-7e80-7000-8000-000000000093",
        subjectPrincipalId: null,
        reviewerPrincipalId: principal.principalId,
        message: "Reliable result.",
      }),
    );
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

  it.each([
    ["amount", { amountBaseUnits: "1" }],
    [
      "terms",
      {
        termsHash:
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
    ],
    ["chain", { chainId: 56 as const }],
    ["mandate version", { mandateVersion: 3 }],
    ["principal", { principal: otherAccount.address }],
  ])("rejects a signature over modified %s", async (_label, modification) => {
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
    const altered = { ...challenge.authorization, ...modification };
    const signature = await account.signTypedData(
      agreementAuthorizationTypedData(altered as never, contract),
    );
    await expect(
      service.verifyAuthorization(
        principal,
        store.agreement.id,
        challenge.challengeId,
        signature,
      ),
    ).rejects.toThrow(/signer/i);
  });

  it("binds exact-action approval to its action hash and rejects replay", async () => {
    const store = new MemoryCommerceStore();
    store.agreement.status = "ACTIVE";
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
    const actionHash = `0x${"ab".repeat(32)}` as const;
    const challenge = await service.authorizationChallenge(
      principal,
      store.agreement.id,
      actionHash,
    );
    const signature = await account.signTypedData(
      executionApprovalTypedData(
        { ...challenge.authorization, actionHash },
        contract,
      ),
    );
    await expect(
      service.verifyAuthorization(
        principal,
        store.agreement.id,
        challenge.challengeId,
        signature,
      ),
    ).resolves.toHaveProperty("artifactId");
    expect(store.authorization).toMatchObject({
      authorization: { actionHash },
    });
    await expect(
      service.verifyAuthorization(
        principal,
        store.agreement.id,
        challenge.challengeId,
        signature,
      ),
    ).rejects.toThrow(/already|invalid|expired|replay/i);
  });

  it.each([
    ["action hash", { actionHash: `0x${"bc".repeat(32)}` as const }],
    ["chain", { chainId: 56 as const }],
    ["mandate version", { mandateVersion: 3 }],
    ["agreement", { agreementId: "01945b1e-7e80-7000-8000-000000000099" }],
  ])(
    "rejects an exact-action signature over modified %s",
    async (_label, modification) => {
      const store = new MemoryCommerceStore();
      store.agreement.status = "ACTIVE";
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
      const actionHash = `0x${"ab".repeat(32)}` as const;
      const challenge = await service.authorizationChallenge(
        principal,
        store.agreement.id,
        actionHash,
      );
      const altered = { ...challenge.authorization, ...modification };
      const signature = await account.signTypedData(
        executionApprovalTypedData(altered as never, contract),
      );
      await expect(
        service.verifyAuthorization(
          principal,
          store.agreement.id,
          challenge.challengeId,
          signature,
        ),
      ).rejects.toThrow(/signer/i);
    },
  );
});

const router = "0x6666666666666666666666666666666666666666" as const;
const policy = "0x7777777777777777777777777777777777777777" as const;
const commerce = "0x5555555555555555555555555555555555555555" as const;
const registerAbi = [
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
const getJobAbi = [
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
] as const;
const setBudgetAbi = [
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
] as const;
const fundAbi = [
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

class MemoryWalletOperationStore {
  operation = {
    id: "01945b1e-7e80-7000-8000-000000000050",
    activationId: "01945b1e-7e80-7000-8000-000000000051",
    executionRequestId: "01945b1e-7e80-7000-8000-000000000052",
    operationType: "REGISTER_JOB",
    state: "AWAITING_SIGNATURE",
    transactionHash: null as string | null,
    preparedPayloadHash: keccak256(
      encodeFunctionData({
        abi: registerAbi,
        functionName: "registerJob",
        args: [608n, policy],
      }),
    ),
    evidence: {
      contract: router,
      functionArguments: { jobId: "608", policy },
    },
  };
  agreement = {
    id: "01945b1e-7e80-7000-8000-000000000053",
    principalId: principalIdForWallet(account.address, 97),
    status: "ACTIVE",
    operations: [this.operation],
  };
  activation = {
    id: this.operation.activationId,
    purpose: "USER_COMMERCE",
    chainId: 97,
    lifecycleState: "ONCHAIN_CREATED",
    reconciliationState: "CURRENT",
    clientAddress: account.address,
    externalJobId: "608",
  };
  async findAgreement() {
    return this.agreement;
  }
  async walletOperationActivation() {
    return this.activation;
  }
  async recordWalletSubmittedOperation(input: {
    transactionHash: string;
    signerAddress: string;
    preparedPayloadHash: string;
    nonce?: bigint;
  }) {
    if (this.operation.transactionHash === input.transactionHash)
      return this.operation;
    if (this.operation.transactionHash !== null)
      throw new Error(
        "A different transaction hash is already recorded for this operation",
      );
    if (
      this.operation.state !== "AWAITING_SIGNATURE" ||
      this.operation.preparedPayloadHash !== input.preparedPayloadHash
    )
      throw new Error("Commerce operation is no longer eligible");
    Object.assign(this.operation, {
      state: "SUBMITTED",
      transactionHash: input.transactionHash,
      signerAddress: input.signerAddress,
      nonce: input.nonce,
    });
    return this.operation;
  }
}

const rpcFetch = ({
  hasBudget = false,
  currentPolicy = "0x0000000000000000000000000000000000000000",
  quoteRemainingSeconds = 900,
}: {
  hasBudget?: boolean;
  currentPolicy?: `0x${string}`;
  quoteRemainingSeconds?: number;
} = {}) =>
  vi.fn(async (_input: string | URL | Request, init?: RequestInit) => {
    if (typeof init?.body !== "string")
      throw new Error("Expected a JSON-RPC request body");
    const payload = JSON.parse(init.body) as {
      id: number;
      method: string;
      params?: Array<Record<string, string>>;
    };
    let result = "0x";
    if (payload.method === "eth_getCode") result = "0x6000";
    if (payload.method === "eth_call") {
      const data = payload.params?.[0]?.data ?? "0x";
      if (
        data.startsWith(
          encodeFunctionData({
            abi: getJobAbi,
            functionName: "getJob",
            args: [608n],
          }).slice(0, 10),
        )
      )
        result = encodeFunctionResult({
          abi: getJobAbi,
          functionName: "getJob",
          result: {
            id: 608n,
            client: account.address,
            provider: otherAccount.address,
            evaluator: router,
            description: JSON.stringify({
              negotiated_at: Math.floor(now.getTime() / 1_000),
              quote_expires_at:
                Math.floor(now.getTime() / 1_000) + quoteRemainingSeconds,
            }),
            budget: 0n,
            expiredAt: BigInt(Math.floor(now.getTime() / 1_000) + 3600),
            status: 0,
            hook: router,
            submittedAt: 0n,
            deliverable: `0x${"00".repeat(32)}`,
          },
        });
      else if (
        data.startsWith(
          encodeFunctionData({
            abi: setBudgetAbi,
            functionName: "jobHasBudget",
            args: [608n],
          }).slice(0, 10),
        )
      )
        result = encodeFunctionResult({
          abi: setBudgetAbi,
          functionName: "jobHasBudget",
          result: hasBudget,
        });
      else if (
        data.startsWith(
          encodeFunctionData({
            abi: registerAbi,
            functionName: "jobPolicy",
            args: [608n],
          }).slice(0, 10),
        )
      )
        result = encodeFunctionResult({
          abi: registerAbi,
          functionName: "jobPolicy",
          result: currentPolicy,
        });
      else if (
        data.startsWith(
          encodeFunctionData({
            abi: registerAbi,
            functionName: "policyWhitelist",
            args: [policy],
          }).slice(0, 10),
        )
      )
        result = encodeFunctionResult({
          abi: registerAbi,
          functionName: "policyWhitelist",
          result: true,
        });
    }
    return new Response(
      JSON.stringify({ jsonrpc: "2.0", id: payload.id, result }),
      { headers: { "content-type": "application/json" } },
    );
  });

afterEach(() => vi.unstubAllGlobals());

describe("wallet commerce operation preflight", () => {
  const principal = {
    principalId: principalIdForWallet(account.address, 97),
    walletAddress: account.address,
    chainId: 97,
    sessionId: "01945b1e-7e80-7000-8000-000000000054",
  };

  it("returns the existing REGISTER_JOB transaction after live fail-closed checks", async () => {
    vi.stubGlobal("fetch", rpcFetch());
    const store = new MemoryWalletOperationStore();
    const service = new CommerceApplicationService(
      store as never,
      router,
      () => now,
      {
        commerceAddress: commerce,
        evaluatorAddress: router,
        policyAddress: policy,
        rpcUrl: "https://rpc.invalid",
      },
    );
    await expect(
      service.refreshPreparedWalletTransaction(
        principal,
        store.agreement.id,
        store.operation.id,
      ),
    ).resolves.toMatchObject({
      operationId: store.operation.id,
      operationType: "REGISTER_JOB",
      chainId: 97,
      from: account.address,
      to: router,
      value: "0x0",
      preparedPayloadHash: store.operation.preparedPayloadHash,
      presentation: { fundsExpectedToMove: false, jobId: "608" },
    });
  });

  it("rejects REGISTER_JOB when the signed quote cannot cover the remaining setup flow", async () => {
    vi.stubGlobal("fetch", rpcFetch({ quoteRemainingSeconds: 7 * 60 }));
    const store = new MemoryWalletOperationStore();
    const service = new CommerceApplicationService(
      store as never,
      router,
      () => now,
      {
        commerceAddress: commerce,
        evaluatorAddress: router,
        policyAddress: policy,
        rpcUrl: "https://rpc.invalid",
      },
    );
    await expect(
      service.refreshPreparedWalletTransaction(
        principal,
        store.agreement.id,
        store.operation.id,
      ),
    ).rejects.toThrow(/insufficient remaining lifetime/i);
  });

  const useSetBudgetOperation = (store: MemoryWalletOperationStore) => {
    const data = encodeFunctionData({
      abi: setBudgetAbi,
      functionName: "setBudget",
      args: [608n, 0n, "0x"],
    });
    Object.assign(store.operation, {
      operationType: "SET_BUDGET",
      preparedPayloadHash: keccak256(data),
      evidence: {
        contract: commerce,
        calldata: data,
        functionArguments: { jobId: "608", amount: "0", optParams: "0x" },
      },
    });
    store.agreement.operations = [store.operation];
    return data;
  };

  const useFundOperation = (store: MemoryWalletOperationStore) => {
    const data = encodeFunctionData({
      abi: fundAbi,
      functionName: "fund",
      args: [608n, 0n, "0x"],
    });
    Object.assign(store.operation, {
      operationType: "FUND",
      preparedPayloadHash: keccak256(data),
      evidence: {
        contract: commerce,
        calldata: data,
        functionArguments: {
          jobId: "608",
          expectedBudget: "0",
          optParams: "0x",
        },
      },
    });
    store.agreement.operations = [store.operation];
    return data;
  };

  it("returns the existing SET_BUDGET transaction after live fail-closed checks", async () => {
    vi.stubGlobal("fetch", rpcFetch({ currentPolicy: policy }));
    const store = new MemoryWalletOperationStore();
    const data = useSetBudgetOperation(store);
    const service = new CommerceApplicationService(
      store as never,
      router,
      () => now,
      {
        commerceAddress: commerce,
        evaluatorAddress: router,
        policyAddress: policy,
        rpcUrl: "https://rpc.invalid",
      },
    );
    await expect(
      service.refreshPreparedWalletTransaction(
        principal,
        store.agreement.id,
        store.operation.id,
      ),
    ).resolves.toMatchObject({
      operationId: store.operation.id,
      operationType: "SET_BUDGET",
      chainId: 97,
      from: account.address,
      to: commerce,
      data,
      value: "0x0",
      preparedPayloadHash: keccak256(data),
      presentation: {
        title: "Set job budget",
        servicePrice: "Free / 0",
        fundsExpectedToMove: false,
      },
    });
  });

  it.each([
    ["wrong signer", { activation: { clientAddress: otherAccount.address } }],
    ["already submitted", { operation: { state: "SUBMITTED" } }],
    [
      "existing transaction hash",
      { operation: { transactionHash: `0x${"ab".repeat(32)}` } },
    ],
    ["calldata mismatch", { operation: { evidence: { calldata: "0x1234" } } }],
  ])("rejects SET_BUDGET with %s", async (_label, changes) => {
    vi.stubGlobal("fetch", rpcFetch({ currentPolicy: policy }));
    const store = new MemoryWalletOperationStore();
    useSetBudgetOperation(store);
    if ("operation" in changes) {
      if ("evidence" in changes.operation)
        Object.assign(store.operation.evidence, changes.operation.evidence);
      else Object.assign(store.operation, changes.operation);
    }
    if ("activation" in changes)
      Object.assign(store.activation, changes.activation);
    const service = new CommerceApplicationService(
      store as never,
      router,
      () => now,
      {
        commerceAddress: commerce,
        evaluatorAddress: router,
        policyAddress: policy,
        rpcUrl: "https://rpc.invalid",
      },
    );
    await expect(
      service.refreshPreparedWalletTransaction(
        principal,
        store.agreement.id,
        store.operation.id,
      ),
    ).rejects.toThrow(/eligible|current|mismatch/i);
  });

  it("rejects SET_BUDGET when the authenticated session is on the wrong network", async () => {
    const store = new MemoryWalletOperationStore();
    useSetBudgetOperation(store);
    const service = new CommerceApplicationService(
      store as never,
      router,
      () => now,
      {
        commerceAddress: commerce,
        evaluatorAddress: router,
        policyAddress: policy,
        rpcUrl: "https://rpc.invalid",
      },
    );
    await expect(
      service.refreshPreparedWalletTransaction(
        { ...principal, chainId: 56 },
        store.agreement.id,
        store.operation.id,
      ),
    ).rejects.toThrow(/BSC Testnet/i);
  });

  it("rejects SET_BUDGET when the budget flag is already initialized", async () => {
    vi.stubGlobal(
      "fetch",
      rpcFetch({ hasBudget: true, currentPolicy: policy }),
    );
    const store = new MemoryWalletOperationStore();
    useSetBudgetOperation(store);
    const service = new CommerceApplicationService(
      store as never,
      router,
      () => now,
      {
        commerceAddress: commerce,
        evaluatorAddress: router,
        policyAddress: policy,
        rpcUrl: "https://rpc.invalid",
      },
    );
    await expect(
      service.refreshPreparedWalletTransaction(
        principal,
        store.agreement.id,
        store.operation.id,
      ),
    ).rejects.toThrow(/not eligible/i);
  });

  it("records one valid SET_BUDGET hash and rejects a competing hash", async () => {
    const store = new MemoryWalletOperationStore();
    useSetBudgetOperation(store);
    const service = new CommerceApplicationService(store as never, router);
    const hash = `0x${"12".repeat(32)}`;
    const input = [
      principal,
      store.agreement.id,
      store.operation.id,
      hash,
      account.address,
      store.operation.preparedPayloadHash,
      2n,
    ] as const;
    await expect(
      service.recordWalletSubmission(...input),
    ).resolves.toMatchObject({
      state: "SUBMITTED",
      transactionHash: hash,
      nonce: "2",
    });
    await expect(
      service.recordWalletSubmission(...input),
    ).resolves.toMatchObject({ transactionHash: hash });
    await expect(
      service.recordWalletSubmission(
        principal,
        store.agreement.id,
        store.operation.id,
        `0x${"34".repeat(32)}`,
        account.address,
        store.operation.preparedPayloadHash,
      ),
    ).rejects.toThrow(/different transaction hash/i);
  });

  it("returns the existing FUND transaction after live fail-closed checks", async () => {
    vi.stubGlobal(
      "fetch",
      rpcFetch({ hasBudget: true, currentPolicy: policy }),
    );
    const store = new MemoryWalletOperationStore();
    const data = useFundOperation(store);
    const service = new CommerceApplicationService(
      store as never,
      router,
      () => now,
      {
        commerceAddress: commerce,
        evaluatorAddress: router,
        policyAddress: policy,
        rpcUrl: "https://rpc.invalid",
      },
    );
    await expect(
      service.refreshPreparedWalletTransaction(
        principal,
        store.agreement.id,
        store.operation.id,
      ),
    ).resolves.toMatchObject({
      operationId: store.operation.id,
      operationType: "FUND",
      chainId: 97,
      from: account.address,
      to: commerce,
      data,
      value: "0x0",
      preparedPayloadHash: keccak256(data),
      presentation: {
        title: "Fund free job",
        servicePrice: "Free / 0",
        fundsExpectedToMove: false,
      },
    });
  });

  it.each([
    ["wrong signer", { activation: { clientAddress: otherAccount.address } }],
    ["already submitted", { operation: { state: "SUBMITTED" } }],
    ["calldata mismatch", { operation: { evidence: { calldata: "0x1234" } } }],
  ])("rejects FUND with %s", async (_label, changes) => {
    vi.stubGlobal(
      "fetch",
      rpcFetch({ hasBudget: true, currentPolicy: policy }),
    );
    const store = new MemoryWalletOperationStore();
    useFundOperation(store);
    if ("operation" in changes) {
      if ("evidence" in changes.operation)
        Object.assign(store.operation.evidence, changes.operation.evidence);
      else Object.assign(store.operation, changes.operation);
    }
    if ("activation" in changes)
      Object.assign(store.activation, changes.activation);
    const service = new CommerceApplicationService(
      store as never,
      router,
      () => now,
      {
        commerceAddress: commerce,
        evaluatorAddress: router,
        policyAddress: policy,
        rpcUrl: "https://rpc.invalid",
      },
    );
    await expect(
      service.refreshPreparedWalletTransaction(
        principal,
        store.agreement.id,
        store.operation.id,
      ),
    ).rejects.toThrow(/eligible|current|mismatch/i);
  });

  it("rejects FUND until the explicit budget flag is initialized", async () => {
    vi.stubGlobal("fetch", rpcFetch({ currentPolicy: policy }));
    const store = new MemoryWalletOperationStore();
    useFundOperation(store);
    const service = new CommerceApplicationService(
      store as never,
      router,
      () => now,
      {
        commerceAddress: commerce,
        evaluatorAddress: router,
        policyAddress: policy,
        rpcUrl: "https://rpc.invalid",
      },
    );
    await expect(
      service.refreshPreparedWalletTransaction(
        principal,
        store.agreement.id,
        store.operation.id,
      ),
    ).rejects.toThrow(/not eligible/i);
  });

  it("records one valid FUND hash and rejects a competing hash", async () => {
    const store = new MemoryWalletOperationStore();
    useFundOperation(store);
    const service = new CommerceApplicationService(store as never, router);
    const hash = `0x${"34".repeat(32)}`;
    const input = [
      principal,
      store.agreement.id,
      store.operation.id,
      hash,
      account.address,
      store.operation.preparedPayloadHash,
      5n,
    ] as const;
    await expect(
      service.recordWalletSubmission(...input),
    ).resolves.toMatchObject({
      state: "SUBMITTED",
      transactionHash: hash,
      nonce: "5",
    });
    await expect(
      service.recordWalletSubmission(...input),
    ).resolves.toMatchObject({ transactionHash: hash });
    await expect(
      service.recordWalletSubmission(
        principal,
        store.agreement.id,
        store.operation.id,
        `0x${"35".repeat(32)}`,
        account.address,
        store.operation.preparedPayloadHash,
      ),
    ).rejects.toThrow(/different transaction hash/i);
  });

  it.each([
    ["wrong buyer", { activation: { clientAddress: otherAccount.address } }],
    ["wrong state", { operation: { state: "SUBMITTED" } }],
    [
      "existing hash",
      { operation: { transactionHash: `0x${"ab".repeat(32)}` } },
    ],
    [
      "payload mismatch",
      { operation: { preparedPayloadHash: `0x${"cd".repeat(32)}` } },
    ],
  ])("rejects REGISTER_JOB with %s", async (_label, changes) => {
    const store = new MemoryWalletOperationStore();
    if ("operation" in changes)
      Object.assign(store.operation, changes.operation);
    if ("activation" in changes)
      Object.assign(store.activation, changes.activation);
    store.agreement.operations = [store.operation];
    const service = new CommerceApplicationService(
      store as never,
      router,
      () => now,
      {
        commerceAddress: commerce,
        evaluatorAddress: router,
        policyAddress: policy,
        rpcUrl: "https://rpc.invalid",
      },
    );
    await expect(
      service.refreshPreparedWalletTransaction(
        principal,
        store.agreement.id,
        store.operation.id,
      ),
    ).rejects.toThrow(/eligible|current|mismatch/i);
  });

  it("rejects a wallet session on the wrong chain", async () => {
    const store = new MemoryWalletOperationStore();
    const service = new CommerceApplicationService(
      store as never,
      router,
      () => now,
      {
        commerceAddress: commerce,
        evaluatorAddress: router,
        policyAddress: policy,
        rpcUrl: "https://rpc.invalid",
      },
    );
    await expect(
      service.refreshPreparedWalletTransaction(
        { ...principal, chainId: 56 },
        store.agreement.id,
        store.operation.id,
      ),
    ).rejects.toThrow(/BSC Testnet/i);
  });

  it("preserves the existing CREATE_JOB prepared transaction path", async () => {
    const actionHash = `0x${"ab".repeat(32)}`;
    const authorizationId = "01945b1e-7e80-7000-8000-000000000060";
    const executionRequestId = "01945b1e-7e80-7000-8000-000000000061";
    const expiredAt = String(Math.floor(now.getTime() / 1_000) + 3600);
    const description = `${actionHash}:0x2A1317EC5fb5557A4cAd0B97fd851630aD8EDA87`;
    const createAbi = [
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
    const data = encodeFunctionData({
      abi: createAbi,
      functionName: "createJob",
      args: [
        otherAccount.address,
        router,
        BigInt(expiredAt),
        description,
        router,
      ],
    });
    const operation = {
      id: "01945b1e-7e80-7000-8000-000000000062",
      operationType: "CREATE_JOB",
      state: "AWAITING_SIGNATURE",
      transactionHash: null,
      activationId: "01945b1e-7e80-7000-8000-000000000063",
      executionRequestId,
      preparedPayloadHash: keccak256(data),
      evidence: {
        exactActionAuthorizationId: authorizationId,
        actionHash,
        negotiatedAt: Math.floor(now.getTime() / 1_000),
        quoteExpiresAt: Math.floor(now.getTime() / 1_000) + 900,
        jobExpiresAt: expiredAt,
        contract: commerce,
        functionArguments: {
          provider: otherAccount.address,
          evaluator: router,
          expiredAt,
          description,
          hook: router,
        },
      },
    };
    const agreement = {
      id: "01945b1e-7e80-7000-8000-000000000064",
      status: "ACTIVE",
      principalId: principal.principalId,
      mandateId: "01945b1e-7e80-7000-8000-000000000065",
      mandateVersion: 1,
      operations: [operation],
    };
    const store = {
      async findAgreement() {
        return agreement;
      },
      async authorizationArtifact() {
        return {
          id: authorizationId,
          principalId: principal.principalId,
          agreementId: agreement.id,
          executionRequestId,
          mandateId: agreement.mandateId,
          mandateVersion: 1,
          chainId: 97,
          signerAddress: account.address,
          actionHash,
          verificationStatus: "VERIFIED",
          revokedAt: null,
          expiresAt: new Date(now.getTime() + 20 * 60_000),
        };
      },
    };
    const service = new CommerceApplicationService(
      store as never,
      router,
      () => now,
    );
    await expect(
      service.preparedWalletTransaction(principal, agreement.id, operation.id),
    ).resolves.toMatchObject({
      operationType: "CREATE_JOB",
      data,
      preparedPayloadHash: operation.preparedPayloadHash,
      presentation: { fundsExpectedToMove: false },
    });
    operation.evidence.quoteExpiresAt =
      Math.floor(now.getTime() / 1_000) + 10 * 60;
    await expect(
      service.preparedWalletTransaction(principal, agreement.id, operation.id),
    ).rejects.toThrow(/no longer current/i);
  });
});
