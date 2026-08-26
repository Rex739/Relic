import { describe, expect, it } from "vitest";

import { walletTypedDataPayload } from "../app/_components/wallet-provider";

describe("wallet typed-data serialization", () => {
  it("adds the explicit EIP-712 domain required by raw browser wallet RPC", () => {
    const payload = walletTypedDataPayload({
      domain: {
        name: "Relic Agent Commerce",
        version: "1",
        chainId: 97,
        verifyingContract: "0x1111111111111111111111111111111111111111",
      },
      primaryType: "CommerceAuthorization",
      types: {
        CommerceAuthorization: [{ name: "agreementId", type: "string" }],
      },
      message: { agreementId: "agreement" },
    });
    expect(payload.types).toMatchObject({
      EIP712Domain: [
        { name: "name", type: "string" },
        { name: "version", type: "string" },
        { name: "chainId", type: "uint256" },
        { name: "verifyingContract", type: "address" },
      ],
      CommerceAuthorization: [{ name: "agreementId", type: "string" }],
    });
  });

  it("fails closed when message types are absent", () => {
    expect(() => walletTypedDataPayload({ types: null })).toThrow(
      /missing its types/i,
    );
  });
});
