import type {
  CommerceProvider,
  CommerceTerms,
  Erc8183JobState,
  PreparedCommerceJob,
} from "@relic/domain";
import { erc8183JobState } from "@relic/domain";
import type { Address, PublicClient } from "viem";
import { getAddress, isAddress } from "viem";

export const ERC8183_DEPLOYMENTS = {
  56: {
    commerce: getAddress("0xea4daa3100a767e86fded867729ae7446476eba6"),
    paymentToken: getAddress("0xcE24439F2D9C6a2289F741120FE202248B666666"),
  },
  97: {
    commerce: getAddress("0xa206c0517b6371c6638cd9e4a42cc9f02a33b0de"),
    paymentToken: getAddress("0xc70B8741B8B07A6d61E54fd4B20f22Fa648E5565"),
  },
} as const;

const commerceAbi = [
  {
    type: "function",
    name: "paymentToken",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "address" }],
  },
  {
    type: "function",
    name: "getJob",
    stateMutability: "view",
    inputs: [{ name: "jobId", type: "uint256" }],
    outputs: [
      {
        name: "",
        type: "tuple",
        components: [
          { name: "id", type: "uint256" },
          { name: "client", type: "address" },
          { name: "provider", type: "address" },
          { name: "evaluator", type: "address" },
          { name: "description", type: "string" },
          { name: "budget", type: "uint256" },
          { name: "expiredAt", type: "uint256" },
          { name: "status", type: "uint8" },
          { name: "hook", type: "address" },
          { name: "submittedAt", type: "uint256" },
          { name: "deliverable", type: "bytes32" },
        ],
      },
    ],
  },
] as const;

const readOnlyError = () =>
  new Error(
    "ERC-8183 write blocked: Relic has no configured signer and never creates or imports a wallet automatically",
  );

export class ReadOnlyErc8183Provider implements CommerceProvider {
  constructor(
    private readonly client: PublicClient,
    private readonly chainId: 56 | 97,
    private readonly providerAddress: Address | null = null,
    private readonly budget: bigint | null = null,
  ) {}

  async inspectDeployment() {
    const deployment = ERC8183_DEPLOYMENTS[this.chainId];
    const [bytecode, paymentToken] = await Promise.all([
      this.client.getCode({ address: deployment.commerce }),
      this.client.readContract({
        address: deployment.commerce,
        abi: commerceAbi,
        functionName: "paymentToken",
      }),
    ]);
    return {
      chainId: this.chainId,
      commerceAddress: deployment.commerce,
      contractDeployed: bytecode !== undefined && bytecode !== "0x",
      paymentToken: getAddress(paymentToken),
      paymentTokenMatchesPublishedDeployment:
        getAddress(paymentToken) === deployment.paymentToken,
    };
  }

  async getServiceTerms(): Promise<CommerceTerms> {
    const deployment = await this.inspectDeployment();
    if (!deployment.contractDeployed)
      throw new Error("Published ERC-8183 commerce address has no bytecode");
    return {
      chainId: this.chainId,
      commerceAddress: deployment.commerceAddress,
      paymentToken: deployment.paymentToken,
      providerAddress: this.providerAddress,
      budget: this.budget,
      source: "onchain-read",
    };
  }

  prepareJob(input: PreparedCommerceJob): Promise<PreparedCommerceJob> {
    if (
      !isAddress(input.provider) ||
      !isAddress(input.evaluator) ||
      !isAddress(input.hook)
    )
      throw new Error("ERC-8183 job contains an invalid address");
    if (input.expiresAt <= BigInt(Math.floor(Date.now() / 1_000) + 300))
      throw new Error(
        "ERC-8183 job expiry must be more than five minutes away",
      );
    if (input.description.trim() === "")
      throw new Error("ERC-8183 job description is required");
    if (input.budget < 0n)
      throw new Error("ERC-8183 job budget cannot be negative");
    return Promise.resolve(input);
  }

  async getJob(jobId: bigint): Promise<{ id: bigint; state: Erc8183JobState }> {
    const job = await this.client.readContract({
      address: ERC8183_DEPLOYMENTS[this.chainId].commerce,
      abi: commerceAbi,
      functionName: "getJob",
      args: [jobId],
    });
    return { id: job.id, state: erc8183JobState(job.status) };
  }

  createJob(input: PreparedCommerceJob): Promise<bigint> {
    void input;
    return Promise.reject(readOnlyError());
  }
  registerJob(jobId: bigint): Promise<`0x${string}`> {
    void jobId;
    return Promise.reject(readOnlyError());
  }
  setBudget(jobId: bigint, amount: bigint): Promise<`0x${string}`> {
    void jobId;
    void amount;
    return Promise.reject(readOnlyError());
  }
  fundJob(jobId: bigint, expectedBudget: bigint): Promise<`0x${string}`> {
    void jobId;
    void expectedBudget;
    return Promise.reject(readOnlyError());
  }
  submit(jobId: bigint, deliverable: `0x${string}`): Promise<`0x${string}`> {
    void jobId;
    void deliverable;
    return Promise.reject(readOnlyError());
  }
  settle(jobId: bigint, evidence: `0x${string}`): Promise<`0x${string}`> {
    void jobId;
    void evidence;
    return Promise.reject(readOnlyError());
  }
  reject(jobId: bigint, reason: `0x${string}`): Promise<`0x${string}`> {
    void jobId;
    void reason;
    return Promise.reject(readOnlyError());
  }
  claimRefund(jobId: bigint): Promise<`0x${string}`> {
    void jobId;
    return Promise.reject(readOnlyError());
  }
}
