import {
  assertActivationLifecycleTransition,
  assertSubmissionTransition,
  buildOwnershipMessage,
  supplyTypeSchema,
} from "../src/index.js";
import { describe, expect, it } from "vitest";

describe("supply onboarding", () => {
  it("keeps the reference classification distinct from trust", () => {
    expect(supplyTypeSchema.options).toEqual([
      "third_party",
      "partner",
      "relic_reference",
    ]);
  });

  it("enforces evidence-driven submission progression", () => {
    expect(() =>
      assertSubmissionTransition("SUBMITTED", "IDENTITY_CHECK"),
    ).not.toThrow();
    expect(() => assertSubmissionTransition("SUBMITTED", "ACTIONABLE")).toThrow(
      /Invalid submission transition/,
    );
  });

  it("uses a stable Relic activation lifecycle", () => {
    expect(() =>
      assertActivationLifecycleTransition("ACTIVE", "DELIVERED"),
    ).not.toThrow();
    expect(() =>
      assertActivationLifecycleTransition("PREPARING", "COMPLETED"),
    ).toThrow(/Invalid activation lifecycle transition/);
  });

  it("binds ownership challenges to identity and expiry", () => {
    const message = buildOwnershipMessage({
      submissionId: "01945b1e-7e80-7000-8000-000000000001",
      chainId: 97,
      registryAddress: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
      externalAgentId: "42",
      nonce: "fixture-only-nonce",
      expiresAt: "2026-08-14T12:00:00.000Z",
    });
    expect(message).toContain("ERC-8004 agent ID: 42");
    expect(message).toContain("Chain ID: 97");
    expect(message).toContain("no transaction is requested");
  });
});
