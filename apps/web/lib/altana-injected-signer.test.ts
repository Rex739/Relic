import { describe, expect, it } from "vitest";
import { privateKeyToAccount } from "viem/accounts";
import { signerFromConnectedWallet } from "./altana-injected-signer";

const privateKey =
  "0x59c6995e998f97a5a0044966f094538e3c4455f7c6d1c884d7d0e0cc1a1b24b4" as const;
const account = privateKeyToAccount(privateKey);

describe("signerFromConnectedWallet", () => {
  it("adapts the already-connected wallet into Altana's signer contract", async () => {
    const provider = {
      request: ({ method, params }: { method: string; params?: unknown[] }) => {
        if (method === "eth_accounts") return Promise.resolve([account.address]);
        if (method === "secp256k1_sign")
          return account.sign({ hash: params?.[0] as `0x${string}` });
        return Promise.reject(new Error(`unexpected method ${method}`));
      },
    };

    const signer = await signerFromConnectedWallet(provider);
    expect(signer.type).toBe("injected");
    expect(signer.address).toBe(account.address);
    await expect(signer.signDigest(`0x${"11".repeat(32)}`)).resolves.toMatch(/^0x/u);
  });

  it("falls back to eth_sign for an injected EOA provider", async () => {
    const provider = {
      request: ({ method, params }: { method: string; params?: unknown[] }) => {
        if (method === "eth_accounts") return Promise.resolve([account.address]);
        if (method === "secp256k1_sign") return Promise.reject(new Error("unsupported"));
        if (method === "eth_sign") return account.sign({ hash: params?.[1] as `0x${string}` });
        return Promise.reject(new Error(`unexpected method ${method}`));
      },
    };

    const signer = await signerFromConnectedWallet(provider);
    await expect(signer.signDigest(`0x${"11".repeat(32)}`)).resolves.toMatch(/^0x/u);
  });

  it("keeps both provider failures visible for an actionable diagnosis", async () => {
    const provider = {
      request: ({ method }: { method: string }) => {
        if (method === "eth_accounts") return Promise.resolve([account.address]);
        if (method === "secp256k1_sign")
          return Promise.reject({ code: 4200, message: "Unsupported method" });
        if (method === "eth_sign")
          return Promise.reject({ code: 4001, message: "User rejected the request" });
        return Promise.reject(new Error(`unexpected method ${method}`));
      },
    };

    await expect(signerFromConnectedWallet(provider)).rejects.toThrow(
      "Privy raw-sign request failed: Unsupported method (code 4200). MetaMask raw-sign fallback failed: User rejected the request (code 4001).",
    );
  });

  it("fails closed when no wallet is connected", async () => {
    await expect(
      signerFromConnectedWallet({ request: () => Promise.resolve([]) }),
    ).rejects.toThrow("Connect a wallet");
  });
});
