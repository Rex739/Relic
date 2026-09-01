import type {
  OnboardingRepository,
  SellerAgentAuthorization,
} from "@relic/domain";
import { MandateValidationError } from "@relic/domain";
import {
  createPublicClient,
  getAddress,
  http,
  type Address,
  type Hex,
} from "viem";
import { bsc, bscTestnet } from "viem/chains";

const identityRegistryAbi = [
  {
    type: "function",
    name: "ownerOf",
    stateMutability: "view",
    inputs: [{ name: "tokenId", type: "uint256" }],
    outputs: [{ name: "owner", type: "address" }],
  },
] as const;

export const ERC8004_REGISTRY_BY_CHAIN = {
  56: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
  97: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
} as const satisfies Record<number, Address>;

export interface Erc8004OwnershipReader {
  registryAddress(chainId: 56 | 97): Address;
  ownerOf(chainId: 56 | 97, externalAgentId: string): Promise<Address>;
  verifyMessage(input: {
    chainId: 56 | 97;
    owner: Address;
    message: string;
    signature: Hex;
  }): Promise<boolean>;
}

export class ViemErc8004OwnershipReader implements Erc8004OwnershipReader {
  readonly #mainnet;
  readonly #testnet;

  constructor(input: { mainnetRpcUrl: string; testnetRpcUrl: string }) {
    this.#mainnet = createPublicClient({
      chain: bsc,
      transport: http(input.mainnetRpcUrl),
    });
    this.#testnet = createPublicClient({
      chain: bscTestnet,
      transport: http(input.testnetRpcUrl),
    });
  }

  registryAddress(chainId: 56 | 97) {
    return ERC8004_REGISTRY_BY_CHAIN[chainId];
  }

  async ownerOf(chainId: 56 | 97, externalAgentId: string) {
    if (!/^\d+$/.test(externalAgentId))
      throw new Error("ERC-8004 Agent ID must be a base-10 integer");
    const owner = await this.#client(chainId).readContract({
      address: this.registryAddress(chainId),
      abi: identityRegistryAbi,
      functionName: "ownerOf",
      args: [BigInt(externalAgentId)],
    });
    return getAddress(owner);
  }

  verifyMessage(input: {
    chainId: 56 | 97;
    owner: Address;
    message: string;
    signature: Hex;
  }) {
    return this.#client(input.chainId).verifyMessage({
      address: input.owner,
      message: input.message,
      signature: input.signature,
    });
  }

  #client(chainId: 56 | 97) {
    return chainId === 56 ? this.#mainnet : this.#testnet;
  }
}

export class SellerAuthorizationGuard {
  constructor(
    private readonly onboarding: OnboardingRepository,
    private readonly ownership: Erc8004OwnershipReader,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async assertAuthorized(principalId: string, agentId: string) {
    const authorization = await this.onboarding.findSellerAuthorization({
      principalId,
      agentId,
    });
    if (authorization === null)
      throw new MandateValidationError(
        "seller_ownership_required",
        "Verify the current ERC-8004 owner before managing this agent.",
      );
    await this.#assertCurrentOwner(authorization);
    return authorization;
  }

  async currentAuthorizations(principalId: string) {
    const authorizations =
      await this.onboarding.listSellerAuthorizations(principalId);
    const current: SellerAgentAuthorization[] = [];
    for (const authorization of authorizations) {
      try {
        await this.#assertCurrentOwner(authorization);
        current.push(authorization);
      } catch (error) {
        if (
          error instanceof MandateValidationError &&
          error.code === "seller_ownership_changed"
        )
          continue;
        throw error;
      }
    }
    return current;
  }

  async #assertCurrentOwner(authorization: SellerAgentAuthorization) {
    let currentOwner: Address;
    try {
      currentOwner = await this.ownership.ownerOf(
        authorization.chainId as 56 | 97,
        authorization.externalAgentId,
      );
    } catch {
      throw new MandateValidationError(
        "seller_ownership_rpc_unavailable",
        "Current ERC-8004 ownership could not be confirmed. Try again before managing this agent.",
      );
    }
    if (getAddress(currentOwner) === getAddress(authorization.verifiedOwner))
      return;
    await this.onboarding.revokeSellerAuthorization({
      authorizationId: authorization.id,
      reason: "erc8004_ownership_transferred",
      revokedAt: this.now(),
    });
    throw new MandateValidationError(
      "seller_ownership_changed",
      "Ownership changed — verify the current owner to continue.",
    );
  }
}
