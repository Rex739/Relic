import { describe, expect, it } from "vitest";

import { walletAuthenticationRequired } from "./auth-state";

describe("authenticated product states", () => {
  it("requires wallet authentication when no Relic session exists", () => {
    expect(walletAuthenticationRequired(undefined)).toBe(true);
    expect(walletAuthenticationRequired("")).toBe(true);
    expect(walletAuthenticationRequired("persisted-session")).toBe(false);
  });
});
