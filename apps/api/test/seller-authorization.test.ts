import type {
  OnboardingRepository,
  SellerAgentAuthorization,
} from "@relic/domain";
import { describe, expect, it } from "vitest";

import { SellerAuthorizationGuard } from "../src/seller-ownership.js";

const owner = "0x1111111111111111111111111111111111111111" as const;
const transferredOwner = "0x2222222222222222222222222222222222222222" as const;
const authorization: SellerAgentAuthorization = {
  id: "01945b1e-7e80-7000-8000-000000000201",
  principalId: "01945b1e-7e80-7000-8000-000000000202",
  submissionId: "01945b1e-7e80-7000-8000-000000000203",
  agentId: "01945b1e-7e80-7000-8000-000000000204",
  chainId: 97,
  registryAddress: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  externalAgentId: "2016",
  verifiedOwner: owner,
  challengeId: "01945b1e-7e80-7000-8000-000000000205",
  verifiedAt: "2026-08-30T12:00:00.000Z",
  lastOwnerCheckedAt: "2026-08-30T12:00:00.000Z",
  revokedAt: null,
  revocationReason: null,
};

const store = (revoke: OnboardingRepository["revokeSellerAuthorization"]) =>
  ({
    findSellerAuthorization: () => Promise.resolve(authorization),
    listSellerAuthorizations: () => Promise.resolve([authorization]),
    revokeSellerAuthorization: revoke,
  }) as unknown as OnboardingRepository;

describe("seller authorization guard", () => {
  it("permits management only while live ownerOf matches", async () => {
    const guard = new SellerAuthorizationGuard(
      store(() => Promise.resolve(false)),
      {
        registryAddress: () => authorization.registryAddress,
        ownerOf: () => Promise.resolve(owner),
        verifyMessage: () => Promise.resolve(false),
      },
    );
    await expect(
      guard.assertAuthorized(authorization.principalId, authorization.agentId!),
    ).resolves.toEqual(authorization);
  });

  it("revokes seller authority when live ownership changed", async () => {
    let revoked: { authorizationId: string; reason: string } | null = null;
    const guard = new SellerAuthorizationGuard(
      store((input) => {
        revoked = input;
        return Promise.resolve(true);
      }),
      {
        registryAddress: () => authorization.registryAddress,
        ownerOf: () => Promise.resolve(transferredOwner),
        verifyMessage: () => Promise.resolve(false),
      },
      () => new Date("2026-08-30T12:05:00.000Z"),
    );
    await expect(
      guard.assertAuthorized(authorization.principalId, authorization.agentId!),
    ).rejects.toMatchObject({
      code: "seller_ownership_changed",
    });
    expect(revoked).toMatchObject({
      authorizationId: authorization.id,
      reason: "erc8004_ownership_transferred",
    });
  });

  it("fails closed without revoking when live RPC is unavailable", async () => {
    let revoked = false;
    const guard = new SellerAuthorizationGuard(
      store(() => {
        revoked = true;
        return Promise.resolve(true);
      }),
      {
        registryAddress: () => authorization.registryAddress,
        ownerOf: () => Promise.reject(new Error("RPC unavailable")),
        verifyMessage: () => Promise.resolve(false),
      },
    );
    await expect(
      guard.assertAuthorized(authorization.principalId, authorization.agentId!),
    ).rejects.toMatchObject({
      code: "seller_ownership_rpc_unavailable",
    });
    expect(revoked).toBe(false);
  });
});
