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

  it("constructs the deterministic account-bound Version 1 challenge", () => {
    const message = buildOwnershipMessage({
      environment: "development",
      origin: "http://localhost:3000",
      principalId: "01945b1e-7e80-7000-8000-000000000001",
      chainId: 97,
      registryAddress: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
      externalAgentId: "42",
      expectedOwner: "0x0000000000000000000000000000000000000042",
      nonce: "fixture-only-nonce",
      issuedAt: "2026-08-14T11:55:00.000Z",
      expiresAt: "2026-08-14T12:00:00.000Z",
    });
    expect(message).toBe(
      [
        "Relic Agent Ownership Verification",
        "",
        "Version: 1",
        "Environment: development",
        "Origin: http://localhost:3000",
        "Agent ID: 42",
        "Chain ID: 97",
        "Registry: 0x8004a818bfb912233c491871b3d84c89a494bd9e",
        "Expected Owner: 0x0000000000000000000000000000000000000042",
        "Relic Account: 01945b1e-7e80-7000-8000-000000000001",
        "Nonce: fixture-only-nonce",
        "Issued At: 2026-08-14T11:55:00.000Z",
        "Expires At: 2026-08-14T12:00:00.000Z",
        "",
        "Purpose:",
        "Authorize this Relic account to manage Agent #42.",
        "No blockchain transaction is requested.",
      ].join("\n"),
    );
    expect(message.endsWith("\n")).toBe(false);
    expect(message.includes("\r")).toBe(false);
  });
});
