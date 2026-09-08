import {
  hexToBytes,
  recoverPublicKey,
  type Address,
  type Hex,
} from "viem";
import type { Signer } from "@altananetwork/sdk";

/** The narrow EIP-1193 surface exposed by Privy's connected wallet. */
export type EthereumProvider = {
  request(args: { method: string; params?: unknown[] }): Promise<unknown>;
};

const isAddress = (value: unknown): value is Address =>
  typeof value === "string" && /^0x[\da-f]{40}$/iu.test(value);

const isSignature = (value: unknown): value is Hex =>
  typeof value === "string" && /^0x[\da-f]{130}$/iu.test(value);

/**
 * Creates Altana's signer shape from the wallet that is already connected to
 * Privy. Altana's relay verifies the underlying secp256k1 digest, not a
 * display-message signature. Privy's embedded-wallet provider exposes this
 * safely as `secp256k1_sign`; injected wallets conventionally expose it as
 * `eth_sign`. We deliberately do not fall back to `personal_sign` or typed
 * data, because either would sign a different digest.
 */
export async function signerFromConnectedWallet(
  provider: EthereumProvider,
): Promise<Signer> {
  const accounts = await provider.request({ method: "eth_accounts" });
  const address = Array.isArray(accounts) ? accounts.find(isAddress) : undefined;
  if (!address)
    throw new Error("Connect a wallet before granting trading permission.");

  const probe: Hex = `0x${"00".repeat(32)}`;
  const signature = await rawDigestSignature(provider, address, probe);
  const publicKey = await recoverPublicKey({ hash: probe, signature });

  return {
    type: "injected",
    address,
    publicKey,
    signDigest: async (digest) => rawDigestSignature(provider, address, digest),
  };
}

async function rawDigestSignature(
  provider: EthereumProvider,
  address: Address,
  digest: Hex,
): Promise<Hex> {
  if (hexToBytes(digest).length !== 32)
    throw new Error("Altana can only authorize a 32-byte transaction digest.");

  let signed: unknown;
  let privyFailure: unknown;
  try {
    signed = await provider.request({
      // Privy's embedded wallet RPC for a raw secp256k1 digest. It is the
      // supported counterpart to eth_sign without prefixing the payload.
      method: "secp256k1_sign",
      params: [digest],
    });
  } catch (caught) {
    privyFailure = caught;
    try {
      // MetaMask/Rabby and other injected EOA providers retain this standard
      // EIP-1193 raw-digest method. Keep it as a compatibility fallback.
      signed = await provider.request({
        method: "eth_sign",
        params: [address, digest],
      });
    } catch (walletFailure) {
      throw new Error(
        `Privy raw-sign request failed: ${describeProviderFailure(privyFailure)}. ` +
          `MetaMask raw-sign fallback failed: ${describeProviderFailure(walletFailure)}.`,
      );
    }
  }
  if (!isSignature(signed))
    throw new Error("The connected wallet returned an invalid permission signature.");
  return signed;
}

/**
 * Wallet providers otherwise hide the only information that distinguishes a
 * rejected request from an unsupported method or a chain/account mismatch.
 * Keep the useful RPC diagnostic in the UI, without serializing provider
 * internals, request params, or any wallet data.
 */
function describeProviderFailure(caught: unknown) {
  if (typeof caught === "object" && caught !== null) {
    const value = caught as { code?: unknown; message?: unknown };
    const code = typeof value.code === "number" || typeof value.code === "string"
      ? ` (code ${String(value.code)})`
      : "";
    if (typeof value.message === "string" && value.message.trim() !== "")
      return `${value.message.trim()}${code}`;
    return `provider returned an unnamed error${code}`;
  }
  if (caught instanceof Error) return caught.message;
  return typeof caught === "string" ? caught : "provider returned an unknown error";
}
