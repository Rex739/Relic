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
  try {
    signed = await provider.request({
      // Privy's embedded wallet RPC for a raw secp256k1 digest. It is the
      // supported counterpart to eth_sign without prefixing the payload.
      method: "secp256k1_sign",
      params: [digest],
    });
  } catch {
    try {
      // MetaMask/Rabby and other injected EOA providers retain this standard
      // EIP-1193 raw-digest method. Keep it as a compatibility fallback.
      signed = await provider.request({
        method: "eth_sign",
        params: [address, digest],
      });
    } catch {
      throw new Error(
        "Your connected wallet cannot sign the secure trading permission. Try reconnecting your Privy wallet, then approve the signature request.",
      );
    }
  }
  if (!isSignature(signed))
    throw new Error("The connected wallet returned an invalid permission signature.");
  return signed;
}
