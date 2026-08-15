import { erc8183JobState } from "@relic/domain";
import type { PublicClient } from "viem";
import { describe, expect, it } from "vitest";

import { assertActivationTransition } from "../src/activation.js";
import { ReadOnlyErc8183Provider } from "../src/erc8183-commerce.js";

describe("ERC-8183 commerce boundary", () => {
  it("maps the deployed APEX job states exactly", () => {
    expect([0, 1, 2, 3, 4, 5].map(erc8183JobState)).toEqual([
      "OPEN",
      "FUNDED",
      "SUBMITTED",
      "COMPLETED",
      "REJECTED",
      "EXPIRED",
    ]);
    expect(() => erc8183JobState(6)).toThrow(/Unknown ERC-8183/);
  });

  it("blocks every write when no signer is configured", async () => {
    const provider = new ReadOnlyErc8183Provider({} as PublicClient, 97);
    await expect(provider.fundJob(1n, 0n)).rejects.toThrow(/write blocked/);
  });

  it("does not permit lifecycle jumps", () => {
    expect(() => assertActivationTransition("PREPARED", "FUNDED")).toThrow(
      /Invalid activation transition/,
    );
    expect(() =>
      assertActivationTransition("PREPARED", "BLOCKED"),
    ).not.toThrow();
  });
});
