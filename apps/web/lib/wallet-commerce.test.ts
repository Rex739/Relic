import { describe, expect, it } from "vitest";

import {
  isTransactionHash,
  quoteHasSafeHeadroom,
  quoteRemainingSeconds,
  walletOperationNeedsReconciliation,
  walletSubmissionError,
} from "./wallet-commerce";

describe("wallet commerce submission guards", () => {
  it("does not accept an empty or missing wallet transaction hash", () => {
    expect(isTransactionHash(undefined)).toBe(false);
    expect(isTransactionHash("")).toBe(false);
    expect(isTransactionHash("0x1234")).toBe(false);
  });

  it("leaves SET_BUDGET awaiting when the wallet returns no hash", () => {
    const operation = { state: "AWAITING_SIGNATURE", transactionHash: null };
    expect(isTransactionHash(undefined)).toBe(false);
    expect(operation).toEqual({
      state: "AWAITING_SIGNATURE",
      transactionHash: null,
    });
  });

  it("accepts one complete provider transaction hash", () => {
    expect(isTransactionHash(`0x${"ab".repeat(32)}`)).toBe(true);
  });

  it("keeps refreshing while a submitted setup step is being reconciled", () => {
    expect(walletOperationNeedsReconciliation("SUBMITTED")).toBe(true);
    expect(walletOperationNeedsReconciliation("PENDING")).toBe(true);
    expect(walletOperationNeedsReconciliation("CONFIRMED")).toBe(true);
    expect(walletOperationNeedsReconciliation("AWAITING_SIGNATURE")).toBe(
      false,
    );
    expect(walletOperationNeedsReconciliation("FINALIZED")).toBe(false);
  });

  it("humanizes wallet rejection without claiming submission", () => {
    const operation = { state: "AWAITING_SIGNATURE", transactionHash: null };
    expect(walletSubmissionError({ code: 4001 })).toMatch(
      /cancelled.*nothing was submitted/i,
    );
    expect(operation).toEqual({
      state: "AWAITING_SIGNATURE",
      transactionHash: null,
    });
  });

  it("shows the 15-minute session countdown and fails closed at the staged threshold", () => {
    const now = Date.parse("2026-08-25T12:00:00.000Z");
    const expiresAt = "2026-08-25T12:15:00.000Z";
    expect(quoteRemainingSeconds(expiresAt, now)).toBe(900);
    expect(quoteHasSafeHeadroom(expiresAt, 720, now)).toBe(true);
    expect(quoteHasSafeHeadroom(expiresAt, 720, now + 181_000)).toBe(false);
  });
});
