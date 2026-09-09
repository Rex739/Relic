import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { serializePermissionAccount, toPermissionValidator } from "@zerodev/permissions";
import {
  CallPolicyVersion,
  ParamCondition,
  toCallPolicy,
  toGasPolicy,
  toTimestampPolicy,
} from "@zerodev/permissions/policies";
import { toECDSASigner } from "@zerodev/permissions/signers";
import { addressToEmptyAccount, constants, createKernelAccount } from "@zerodev/sdk";
import {
  createPublicClient,
  http,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { bsc, bscTestnet } from "viem/chains";

import type { EthereumProvider } from "../app/_components/wallet-provider";

/**
 * Browser-safe description returned by Relic's future session-preparation
 * endpoint. It intentionally contains the agent's public session address,
 * never the session private key or an unrestricted signer.
 */
export type KernelSessionAuthorizationPlan = Readonly<{
  chainId: 56 | 97;
  sessionAddress: Address;
  expiresAt: string;
  allowedCalls: ReadonlyArray<{
    target: Address;
    selector?: Hex;
    valueLimit?: string;
    rules?: ReadonlyArray<{ condition: number; offset: number; params: Hex }>;
  }>;
}>;

// Kernel's documented `oneAddress` sentinel requires a paymaster without
// pinning a provider-specific contract address. This is the right model for
// ZeroDev's hosted v3 sponsor, whose backing paymaster can vary by provider.
const anyPaymaster = "0x0000000000000000000000000000000000000001" as Address;

export type KernelOwnerAccount = Readonly<{
  ownerAddress: Address;
  smartAccountAddress: Address;
  /** Opaque SDK object; callers use it only to submit owner-approved UserOps. */
  account: Awaited<ReturnType<typeof createKernelAccount>>;
}>;

const account = async (provider: EthereumProvider) => {
  const accounts = await provider.request({ method: "eth_accounts" });
  const address = Array.isArray(accounts)
    ? accounts.find(
        (candidate): candidate is Address =>
          typeof candidate === "string" && /^0x[\da-f]{40}$/iu.test(candidate),
      )
    : undefined;
  if (address === undefined)
    throw new Error("Connect the wallet that will own this smart account.");
  return address;
};

/**
 * Builds the buyer-owned Kernel account from MetaMask/Privy EIP-1193.
 *
 * ZeroDev converts message and typed-data signing to the provider's supported
 * methods. This module deliberately never calls `eth_sign` or
 * `secp256k1_sign`: those raw-digest methods are the incompatibility in the
 * legacy Altana path.
 */
export async function createKernelOwnerAccount(input: {
  provider: EthereumProvider;
  chainId: 56 | 97;
  rpcUrl: string;
}): Promise<KernelOwnerAccount> {
  const chain = input.chainId === 56 ? bsc : bscTestnet;
  const client = createPublicClient({ chain, transport: http(input.rpcUrl) });
  const ownerAddress = await account(input.provider);
  const entryPoint = constants.getEntryPoint("0.7");
  const sudo = await signerToEcdsaValidator(client, {
    // Relic's provider is intentionally a narrow EIP-1193 interface. ZeroDev
    // accepts the same provider shape; viem's type carries a broader RPC map.
    signer: input.provider as EIP1193Provider,
    entryPoint,
    kernelVersion: constants.KERNEL_V3_1,
  });
  const kernelAccount = await createKernelAccount(client, {
    entryPoint,
    kernelVersion: constants.KERNEL_V3_1,
    plugins: { sudo },
  });
  return {
    ownerAddress,
    smartAccountAddress: kernelAccount.address,
    account: kernelAccount,
  };
}

/**
 * Creates the exact permission plugin that the owner approves. The empty
 * signer is intentional: installation needs only the session public address;
 * Relic retains the generated private key encrypted server-side and can later
 * reconstruct the same plugin for execution.
 */
export async function createKernelPermissionPlugin(input: {
  plan: KernelSessionAuthorizationPlan;
  rpcUrl: string;
}) {
  const chain = input.plan.chainId === 56 ? bsc : bscTestnet;
  const client = createPublicClient({ chain, transport: http(input.rpcUrl) });
  const entryPoint = constants.getEntryPoint("0.7");
  const sessionSigner = await toECDSASigner({
    signer: addressToEmptyAccount(input.plan.sessionAddress),
  });
  const validUntil = Math.floor(Date.parse(input.plan.expiresAt) / 1_000);
  if (!Number.isSafeInteger(validUntil) || validUntil <= Math.floor(Date.now() / 1_000))
    throw new Error("The smart-account session expiry must be in the future.");

  return toPermissionValidator(client, {
    signer: sessionSigner,
    entryPoint,
    kernelVersion: constants.KERNEL_V3_1,
    policies: [
      toCallPolicy({
        policyVersion: CallPolicyVersion.V0_0_5,
        permissions: input.plan.allowedCalls.map((call) => {
          const base = { target: call.target, valueLimit: BigInt(call.valueLimit ?? "0") };
          if (call.selector === undefined) return base;
          const rules = call.rules?.map((rule) => ({
            ...rule,
            condition: rule.condition as ParamCondition,
          }));
          return { ...base, selector: call.selector, ...(rules === undefined ? {} : { rules }) };
        }),
      }),
      toTimestampPolicy({ validUntil }),
      // A session key may not self-pay. ZeroDev's project policy still limits
      // which sponsored calls may execute and the gas spent per operation.
      toGasPolicy({
        enforcePaymaster: true,
        allowedPaymaster: anyPaymaster,
      }),
    ],
  });
}

/**
 * Produces ZeroDev's serialized owner approval for a server-created session
 * address. MetaMask receives an intelligible EIP-712 signature request; it
 * never sees, exports, or raw-signs with the agent session private key.
 */
export async function createKernelSessionApproval(input: {
  provider: EthereumProvider;
  plan: KernelSessionAuthorizationPlan;
  rpcUrl: string;
}) {
  const chain = input.plan.chainId === 56 ? bsc : bscTestnet;
  const client = createPublicClient({ chain, transport: http(input.rpcUrl) });
  const entryPoint = constants.getEntryPoint("0.7");
  const ownerAddress = await account(input.provider);
  const sudo = await signerToEcdsaValidator(client, {
    signer: input.provider as EIP1193Provider,
    entryPoint,
    kernelVersion: constants.KERNEL_V3_1,
  });
  const regular = await createKernelPermissionPlugin({
    plan: input.plan,
    rpcUrl: input.rpcUrl,
  });
  const sessionKeyAccount = await createKernelAccount(client, {
    entryPoint,
    kernelVersion: constants.KERNEL_V3_1,
    plugins: { sudo, regular },
  });
  const serializedPermissionAccount = await serializePermissionAccount(sessionKeyAccount);
  return {
    ownerAddress,
    smartAccountAddress: sessionKeyAccount.address,
    serializedPermissionAccount,
  };
}

/** Public configuration gate used by checkout. No value means manual approval. */
export function kernelSmartAccountEnabled() {
  return process.env.NEXT_PUBLIC_RELIC_KERNEL_SESSIONS_ENABLED === "true" &&
    typeof process.env.NEXT_PUBLIC_ZERODEV_RPC_URL === "string" &&
    process.env.NEXT_PUBLIC_ZERODEV_RPC_URL.trim() !== "";
}
