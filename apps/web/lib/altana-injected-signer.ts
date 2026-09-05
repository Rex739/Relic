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
 * Privy. It deliberately uses `eth_sign` over a raw 32-byte digest because
 * Altana's relay verifies the underlying secp256k1 digest, not a display
 * message. Providers that cannot sign a raw digest fail closed with a useful
 * error instead of silently falling back to an unrestricted signature.
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
      method: "eth_sign",
      params: [address, digest],
    });
  } catch {
    throw new Error(
      "Your connected wallet cannot sign the secure trading permission. Use a wallet that supports this request.",
    );
  }
  if (!isSignature(signed))
    throw new Error("The connected wallet returned an invalid permission signature.");
  return signed;
}
