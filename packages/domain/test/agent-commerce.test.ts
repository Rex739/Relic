import { describe, expect, it } from "vitest";

import {
  assertAgreementTransition,
  assertOfferTransition,
  commerceAuthorizationTypedData,
  executionApprovalTypedData,
  immutableContentHash,
} from "../src/index.js";

describe("production commerce domain", () => {
  it("hashes accepted terms canonically", () => {
    expect(immutableContentHash({ b: 2, a: 1 })).toBe(
      immutableContentHash({ a: 1, b: 2 }),
    );
  });

  it("enforces offer and agreement lifecycle", () => {
    expect(() => assertOfferTransition("DRAFT", "ACTIVE")).not.toThrow();
    expect(() => assertOfferTransition("DEACTIVATED", "ACTIVE")).toThrow();
    expect(() =>
      assertAgreementTransition("DRAFT", "TERMS_ACCEPTED"),
    ).not.toThrow();
    expect(() =>
      assertAgreementTransition("TERMS_ACCEPTED", "ACTIVE"),
    ).toThrow();
  });

  it("binds typed authorization to terms, action, token, amount, and chain", () => {
    const typed = commerceAuthorizationTypedData(
      {
        agreementId: "01945b1e-7e80-7000-8000-000000000001",
        principal: "0x1111111111111111111111111111111111111111",
        agentId: "01945b1e-7e80-7000-8000-000000000002",
        mandateId: "01945b1e-7e80-7000-8000-000000000003",
        mandateVersion: 1,
        offerVersionId: "01945b1e-7e80-7000-8000-000000000004",
        termsHash:
          "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        actionHash:
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
        tokenAddress: "0x2222222222222222222222222222222222222222",
        amountBaseUnits: "0",
        chainId: 97,
        nonce: "nonce-1234567890abcdef",
        expiresAt: "1787328000",
      },
      "0x3333333333333333333333333333333333333333",
    );
    expect(typed.domain.chainId).toBe(97);
    expect(typed.message.amountBaseUnits).toBe(0n);
    expect(typed.message.actionHash).toMatch(/^0x[b]+$/);
    expect(typed.domain.name).toBe("Relic Exact Execution");
  });

  it("domain-separates agreement authorization from exact execution approval", () => {
    const base = {
      agreementId: "01945b1e-7e80-7000-8000-000000000001",
      principal: "0x1111111111111111111111111111111111111111",
      agentId: "01945b1e-7e80-7000-8000-000000000002",
      mandateId: "01945b1e-7e80-7000-8000-000000000003",
      mandateVersion: 1,
      offerVersionId: "01945b1e-7e80-7000-8000-000000000004",
      termsHash:
        "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      tokenAddress: "0x2222222222222222222222222222222222222222",
      amountBaseUnits: "1000000",
      chainId: 97 as const,
      nonce: "nonce-1234567890abcdef",
      expiresAt: "1787328000",
    };
    const contract = "0x3333333333333333333333333333333333333333" as const;
    const terms = commerceAuthorizationTypedData(
      { ...base, actionHash: null },
      contract,
    );
    const execution = executionApprovalTypedData(
      {
        ...base,
        actionHash:
          "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      },
      contract,
    );
    expect(terms.domain.name).toBe("Relic Agent Commerce");
    expect(execution.domain.name).toBe("Relic Exact Execution");
    expect(terms.primaryType).not.toBe(execution.primaryType);
  });
});
