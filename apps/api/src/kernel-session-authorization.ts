import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { getAddress, padHex, toHex, type Address, type Hex } from "viem";

import type {
  DrizzleKernelSessionAuthorizationStore,
  KernelSessionAuthorizationRecord,
} from "@relic/database";
import { MandateValidationError } from "@relic/domain";

import { AltanaSessionEncryption } from "./altana-session-encryption.js";
import type { MandateApplicationService } from "./mandates.js";

type PermissionSnapshot = {
  calls: Array<{ target: Address; selector: Hex; valueLimit: string; rules: Array<{ condition: number; offset: number; params: Hex }> }>;
};

type GridKernelConfig = Readonly<{ usdt: Address; wrappedBnb: Address; swapRouter: Address; fee: number }>;

const address = (value: unknown): value is Address =>
  typeof value === "string" && /^0x[\da-fA-F]{40}$/u.test(value);

function allowedContracts(value: unknown): Address[] {
  if (!Array.isArray(value)) return [];
  return value.filter(address).map(getAddress);
}

/**
 * Prepares the server side of an owner-approved Kernel permission session.
 *
 * Confirmation deliberately does not activate a mandate. The private runtime
 * must first verify that the submitted serialization resolves to the stored
 * public session key and that the permission plugin is installed on-chain.
 * This avoids treating a browser-provided blob as proof of autonomous power.
 */
export class KernelSessionAuthorizationService {
  public constructor(
    private readonly mandates: MandateApplicationService,
    private readonly store: DrizzleKernelSessionAuthorizationStore,
    private readonly encryption: AltanaSessionEncryption,
    private readonly gridConfig: GridKernelConfig | undefined,
    private readonly now: () => Date = () => new Date(),
  ) {}

  public async prepare(input: { principalId: string; mandateId: string; ownerAddress: string; smartAccountAddress: string }) {
    const { principalId, mandateId } = input;
    const existing = await this.store.find(mandateId, principalId);
    if (existing !== null) {
      if (existing.status === "PENDING" && existing.expiresAt > this.now()) {
        if (
          existing.ownerAddress === null ||
          existing.smartAccountAddress === null ||
          getAddress(input.ownerAddress) !== getAddress(existing.ownerAddress) ||
          getAddress(input.smartAccountAddress) !== getAddress(existing.smartAccountAddress)
        )
          throw new MandateValidationError(
            "kernel_session_account_mismatch",
            "Continue with the exact Kernel account used to prepare this permission.",
          );
        return this.#public(existing);
      }
      throw new MandateValidationError(
        "kernel_session_exists",
        "This mandate already has a completed, revoked, or expired smart-account authorization.",
      );
    }

    const mandate = await this.mandates.get(principalId, mandateId);
    // This reviewed Grid runtime is explicitly configured with PancakeSwap's
    // Testnet token/router addresses. A Mainnet mandate must wait for its own
    // independently reviewed registry and sponsorship policy.
    if (mandate.chainId !== 97)
      throw new MandateValidationError("kernel_session_chain_unsupported", "The current Grid smart-account flow is available on BSC Testnet only.");
    if (mandate.status !== "REVIEWED")
      throw new MandateValidationError("kernel_session_mandate_not_reviewed", "Review this mandate before authorizing a smart-account session.");
    const constraints = mandate.version.riskConstraints;
    const gridConfig = this.gridConfig;
    if (constraints.executionKind !== "PANCAKESWAP_V3_GRID_V1" || gridConfig === undefined)
      throw new MandateValidationError(
        "kernel_session_service_not_ready",
        "Smart-account authorization is currently enabled only for the reviewed Grid Trader flow.",
      );

    const calls = allowedContracts(mandate.version.allowedContracts);
    if (!calls.some((value) => value === gridConfig.usdt) || !calls.some((value) => value === gridConfig.swapRouter))
      throw new MandateValidationError("kernel_session_missing_allowlist", "This mandate does not include the reviewed Grid token and router contracts.");
    const cap = constraints.maximumCapitalBaseUnits;
    if (typeof cap !== "string" || !/^[1-9]\d*$/u.test(cap))
      throw new MandateValidationError("kernel_session_invalid_cap", "Grid Trader requires a positive reviewed capital cap.");
    const expiresAt = new Date(Date.parse(mandate.version.expiresAt));
    if (Number.isNaN(expiresAt.getTime()) || expiresAt <= this.now())
      throw new MandateValidationError("kernel_session_expired", "This mandate is already expired.");

    const privateKey = generatePrivateKey();
    const session = privateKeyToAccount(privateKey);
    const ownerAddress = getAddress(input.ownerAddress);
    const smartAccountAddress = getAddress(input.smartAccountAddress);
    const permissions = this.#gridPermissions({ maximumCapitalBaseUnits: cap, smartAccountAddress });
    const created = await this.store.create({
      mandateId,
      principalId,
      chainId: mandate.chainId,
      ownerAddress,
      smartAccountAddress,
      sessionAddress: session.address,
      sessionPublicKey: session.publicKey,
      encryptedSessionPrivateKey: this.encryption.encrypt(privateKey),
      permissions,
      expiresAt,
      status: "PENDING",
    });
    return this.#public(created);
  }

  public async confirm(input: {
    principalId: string;
    mandateId: string;
    ownerAddress: string;
    smartAccountAddress: string;
    serializedPermissionAccount: string;
  }) {
    const record = await this.store.find(input.mandateId, input.principalId);
    if (record === null)
      throw new MandateValidationError("kernel_session_missing", "Prepare the smart-account authorization first.");
    if (record.status !== "PENDING" || record.expiresAt <= this.now())
      throw new MandateValidationError("kernel_session_not_pending", "This smart-account authorization is no longer awaiting owner confirmation.");
    if (input.serializedPermissionAccount.length < 20 || input.serializedPermissionAccount.length > 100_000)
      throw new MandateValidationError("kernel_session_invalid_serialization", "The submitted smart-account permission is invalid.");
    if (record.ownerAddress === null || record.smartAccountAddress === null || getAddress(input.ownerAddress) !== getAddress(record.ownerAddress) || getAddress(input.smartAccountAddress) !== getAddress(record.smartAccountAddress))
      throw new MandateValidationError("kernel_session_account_mismatch", "Confirm the exact Kernel account used to prepare this permission.");
    const confirmed = await this.store.markOwnerConfirmed({
      mandateId: input.mandateId,
      principalId: input.principalId,
      ownerAddress: getAddress(input.ownerAddress),
      smartAccountAddress: getAddress(input.smartAccountAddress),
      encryptedPermissionAccount: this.encryption.encrypt(input.serializedPermissionAccount),
    });
    if (confirmed === null)
      throw new MandateValidationError("kernel_session_confirmation_failed", "Could not store the owner-approved smart-account permission.");
    await this.mandates.activateAfterKernelAuthorization(input.principalId, input.mandateId, {
      ownerAddress: confirmed.ownerAddress!,
      smartAccountAddress: confirmed.smartAccountAddress!,
      sessionPublicKey: confirmed.sessionPublicKey,
    });
    return this.#public(confirmed);
  }

  public async revoke(principalId: string, mandateId: string) {
    const revoked = await this.store.revoke(mandateId, principalId);
    if (revoked === null)
      throw new MandateValidationError("kernel_session_missing", "No smart-account authorization exists for this mandate.");
    return this.#public(revoked);
  }

  #public(record: KernelSessionAuthorizationRecord) {
    const permissions = record.permissions as PermissionSnapshot;
    return {
      id: record.id,
      mandateId: record.mandateId,
      chainId: record.chainId,
      sessionAddress: record.sessionAddress,
      sessionPublicKey: record.sessionPublicKey,
      allowedCalls: permissions.calls,
      expiresAt: record.expiresAt.toISOString(),
      status: record.status,
      ...(record.ownerAddress === null ? {} : { ownerAddress: record.ownerAddress }),
      ...(record.smartAccountAddress === null ? {} : { smartAccountAddress: record.smartAccountAddress }),
    };
  }

  #gridPermissions(input: { maximumCapitalBaseUnits: string; smartAccountAddress: Address }): PermissionSnapshot {
    const config = this.gridConfig!;
    const word = (value: string | bigint) => padHex(typeof value === "string" ? value as Hex : toHex(value), { size: 32 });
    return {
      calls: [
        {
          target: config.usdt,
          selector: "0x095ea7b3", // approve(address,uint256)
          valueLimit: "0",
          rules: [
            { condition: 0, offset: 0, params: word(config.swapRouter) },
            { condition: 4, offset: 32, params: word(BigInt(input.maximumCapitalBaseUnits)) },
          ],
        },
        {
          target: config.swapRouter,
          selector: "0x04e45aaf", // exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))
          valueLimit: "0",
          rules: [
            { condition: 0, offset: 0, params: word(config.usdt) },
            { condition: 0, offset: 32, params: word(config.wrappedBnb) },
            { condition: 0, offset: 64, params: word(BigInt(config.fee)) },
            { condition: 0, offset: 96, params: word(input.smartAccountAddress) },
            { condition: 4, offset: 128, params: word(BigInt(input.maximumCapitalBaseUnits)) },
          ],
        },
      ],
    };
  }
}
