import { deserializePermissionAccount } from "@zerodev/permissions";
import { toECDSASigner } from "@zerodev/permissions/signers";
import { constants } from "@zerodev/sdk";
import { createPublicClient, getAddress, http, type Address } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { bscTestnet } from "viem/chains";

import type { KernelGridFundedSession } from "./gridFundedSessionClient.js";

const same = (left: string, right: string) => left.toLowerCase() === right.toLowerCase();

/**
 * Reconstructs, but does not yet send from, a buyer-approved Kernel session.
 *
 * This is intentionally a separate step from the legacy Altana executor. It
 * proves that the encrypted private session key, browser serialization, and
 * API record describe the same smart account before a UserOperation sender is
 * allowed to be wired in. There is no fallback to an EOA or raw signing.
 */
export async function reconstructGridKernelSession(input: {
  rpcUrl: string;
  chainId: 97;
  session: KernelGridFundedSession;
}) {
  if (!/^https:\/\//u.test(input.rpcUrl))
    throw new Error("Grid Kernel session requires an HTTPS BSC Testnet RPC URL");
  if (input.session.expiresAt <= new Date())
    throw new Error("Grid Kernel session has expired");

  const localSession = privateKeyToAccount(input.session.sessionPrivateKey);
  if (!same(localSession.address, input.session.sessionAddress))
    throw new Error("Grid Kernel session key does not match the recorded session address");
  if (!same(localSession.publicKey, input.session.sessionPublicKey))
    throw new Error("Grid Kernel session key does not match the recorded public key");

  const client = createPublicClient({ chain: bscTestnet, transport: http(input.rpcUrl) });
  if (await client.getChainId() !== input.chainId)
    throw new Error("Grid Kernel session RPC is not BSC Testnet");
  const entryPoint = constants.getEntryPoint("0.7");
  const signer = await toECDSASigner({ signer: localSession });
  const account = await deserializePermissionAccount(
    client,
    entryPoint,
    constants.KERNEL_V3_1,
    input.session.serializedPermissionAccount,
    signer,
  );
  if (!same(account.address, input.session.smartAccountAddress))
    throw new Error("Grid Kernel permission does not resolve to the approved smart account");

  return Object.freeze({
    account,
    ownerAddress: getAddress(input.session.ownerAddress) as Address,
    smartAccountAddress: getAddress(input.session.smartAccountAddress) as Address,
    expiresAt: input.session.expiresAt,
  });
}
