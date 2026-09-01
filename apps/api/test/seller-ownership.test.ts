import type {
  AgentReadRepository,
  AgentSubmission,
  OnboardingRepository,
  OwnershipChallenge,
  SellerAgentAuthorization,
} from "@relic/domain";
import { recoverMessageAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { createApp } from "../src/app.js";

const owner = privateKeyToAccount(
  "0x0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
);
const wrongSigner = privateKeyToAccount(
  "0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd",
);
const registry = "0x8004A818BFB912233c491871b3d84c89A494BD9e" as const;
const submissionId = "01945b1e-7e80-7000-8000-000000000120";
const challengeId = "01945b1e-7e80-7000-8000-000000000121";
const principalA = "01945b1e-7e80-7000-8000-000000000122";
const principalB = "01945b1e-7e80-7000-8000-000000000123";

const repository: AgentReadRepository = {
  list: () => Promise.resolve({ items: [], nextCursor: null }),
  findById: () => Promise.resolve(null),
};

const harness = (input?: { now?: Date; owner?: `0x${string}` }) => {
  let currentOwner = input?.owner ?? owner.address;
  let consumed = false;
  let challenge: OwnershipChallenge | null = null;
  const submission: AgentSubmission = {
    id: submissionId,
    chainId: 97,
    registryAddress: registry,
    externalAgentId: "2016",
    supplyType: "third_party",
    relicPrincipalId: principalA,
    status: "SUBMITTED",
    submitterAddress: "0x0000000000000000000000000000000000000122",
    ownershipVerifiedAt: null,
    agentId: null,
    candidateId: null,
    developerOverrides: {},
    createdAt: "2026-08-30T12:00:00.000Z",
    updatedAt: "2026-08-30T12:00:00.000Z",
  };
  const authorization: SellerAgentAuthorization = {
    id: "01945b1e-7e80-7000-8000-000000000124",
    principalId: principalA,
    submissionId,
    agentId: null,
    chainId: 97,
    registryAddress: registry,
    externalAgentId: "2016",
    verifiedOwner: owner.address,
    challengeId,
    verifiedAt: "2026-08-30T12:01:00.000Z",
    lastOwnerCheckedAt: "2026-08-30T12:01:00.000Z",
    revokedAt: null,
    revocationReason: null,
  };
  const onboarding: OnboardingRepository = {
    createSubmission: () => Promise.resolve(submission),
    findSubmission: () => Promise.resolve(submission),
    listPendingCatalogSubmissions: () => Promise.resolve([]),
    findSubmissionByIdentity: () => Promise.resolve(submission),
    findOwnershipContext: () =>
      Promise.resolve({
        registryAddress: registry,
        ownerAddress: owner.address,
      }),
    createOwnershipChallenge: (request) => {
      challenge = {
        id: challengeId,
        submissionId,
        principalId: request.principalId,
        chainId: request.chainId,
        registryAddress: request.registryAddress,
        externalAgentId: request.externalAgentId,
        message: request.message,
        expectedOwner: request.expectedOwner,
        issuedAt: request.issuedAt.toISOString(),
        expiresAt: request.expiresAt.toISOString(),
      };
      return Promise.resolve(challenge);
    },
    findOwnershipChallenge: () => Promise.resolve(consumed ? null : challenge),
    consumeOwnershipChallengeAndAuthorize: () => {
      if (consumed) return Promise.resolve(null);
      consumed = true;
      return Promise.resolve(authorization);
    },
    findSellerAuthorization: () => Promise.resolve(null),
    listSellerAuthorizations: () => Promise.resolve([]),
    revokeSellerAuthorization: () => Promise.resolve(false),
  };
  const app = createApp(repository, onboarding, undefined, {
    walletAuthService: {
      session: (token: string) =>
        Promise.resolve(
          token === "principal-a"
            ? {
                principalId: principalA,
                walletAddress: "0x0000000000000000000000000000000000000122",
                chainId: 97,
                sessionId: token,
              }
            : token === "principal-b"
              ? {
                  principalId: principalB,
                  walletAddress: "0x0000000000000000000000000000000000000123",
                  chainId: 97,
                  sessionId: token,
                }
              : null,
        ),
    } as never,
    ownershipReader: {
      registryAddress: () => registry,
      ownerOf: () => Promise.resolve(currentOwner),
      verifyMessage: async (request) =>
        (await recoverMessageAddress({
          message: request.message,
          signature: request.signature,
        })) === request.owner,
    },
    publicOrigin: "http://localhost:3000",
    environmentName: "development",
    now: () => input?.now ?? new Date("2026-08-30T12:00:00.000Z"),
  });
  const issue = (token = "principal-a") =>
    app.request(`/v1/agent-submissions/${submissionId}/ownership-challenges`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
  const verify = (signature: string, token = "principal-a") =>
    app.request(
      `/v1/agent-submissions/${submissionId}/ownership-verification`,
      {
        method: "POST",
        headers: {
          authorization: `Bearer ${token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ challengeId, signature }),
      },
    );
  return {
    app,
    issue,
    verify,
    challenge: () => challenge,
    setOwner: (next: `0x${string}`) => {
      currentOwner = next;
    },
  };
};

describe("seller ownership API", () => {
  it("rejects unauthenticated challenge issuance", async () => {
    const { app } = harness();
    const response = await app.request(
      `/v1/agent-submissions/${submissionId}/ownership-challenges`,
      { method: "POST" },
    );
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "validation_error" },
    });
  });

  it("binds issuance to the authenticated Relic account and trusted origin", async () => {
    const flow = harness();
    expect((await flow.issue("principal-b")).status).toBe(404);
    const issued = await flow.issue();
    expect(issued.status).toBe(201);
    const body = (await issued.json()) as { data: OwnershipChallenge };
    expect(body.data.message).toContain(`Relic Account: ${principalA}`);
    expect(body.data.message).toContain("Origin: http://localhost:3000");
    expect(body.data.message).not.toContain(principalB);
    expect(
      new Date(body.data.expiresAt).getTime() -
        new Date(body.data.issuedAt).getTime(),
    ).toBe(5 * 60 * 1000);
    expect(body.data.message.endsWith("\n")).toBe(false);
  });

  it("ignores client attempts to override the canonical origin", async () => {
    const { app } = harness();
    const response = await app.request(
      `/v1/agent-submissions/${submissionId}/ownership-challenges`,
      {
        method: "POST",
        headers: {
          authorization: "Bearer principal-a",
          "content-type": "application/json",
        },
        body: JSON.stringify({ origin: "https://attacker.invalid" }),
      },
    );
    expect(response.status).toBe(201);
    const body = (await response.json()) as { data: OwnershipChallenge };
    expect(body.data.message).toContain("Origin: http://localhost:3000");
    expect(body.data.message).not.toContain("attacker.invalid");
  });

  it("accepts the current owner EIP-191 signature once", async () => {
    const flow = harness();
    await flow.issue();
    const message = flow.challenge()!.message;
    const signature = await owner.signMessage({ message });
    expect((await flow.verify(signature)).status).toBe(200);
    expect((await flow.verify(signature)).status).toBe(404);
  });

  it("rejects another Relic principal and a wrong signer", async () => {
    const flow = harness();
    await flow.issue();
    const signature = await wrongSigner.signMessage({
      message: flow.challenge()!.message,
    });
    expect((await flow.verify(signature)).status).toBe(400);
    expect((await flow.verify(signature, "principal-b")).status).toBe(404);
  });

  it("fails closed when ownership changes after challenge issuance", async () => {
    const flow = harness();
    await flow.issue();
    const signature = await owner.signMessage({
      message: flow.challenge()!.message,
    });
    flow.setOwner(wrongSigner.address);
    const response = await flow.verify(signature);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ownership_mismatch" },
    });
  });

  it("rejects expired challenges", async () => {
    const flow = harness({ now: new Date("2026-08-30T12:06:00.000Z") });
    await flow.issue();
    const challenge = flow.challenge()!;
    challenge.expiresAt = "2026-08-30T12:05:00.000Z";
    const signature = await owner.signMessage({ message: challenge.message });
    const response = await flow.verify(signature);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ownership_challenge_expired" },
    });
  });

  it.each([
    ["chain", (challenge: OwnershipChallenge) => (challenge.chainId = 56)],
    [
      "registry",
      (challenge: OwnershipChallenge) =>
        (challenge.registryAddress =
          "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432"),
    ],
    [
      "Agent ID",
      (challenge: OwnershipChallenge) => (challenge.externalAgentId = "2017"),
    ],
  ])("rejects a challenge whose %s binding was altered", async (_, mutate) => {
    const flow = harness();
    await flow.issue();
    mutate(flow.challenge()!);
    const signature = await owner.signMessage({
      message: flow.challenge()!.message,
    });
    const response = await flow.verify(signature);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ownership_challenge_mismatch" },
    });
  });
});
