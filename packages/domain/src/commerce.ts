export const ERC8183_JOB_STATES = [
  "OPEN",
  "FUNDED",
  "SUBMITTED",
  "COMPLETED",
  "REJECTED",
  "EXPIRED",
] as const;

export type Erc8183JobState = (typeof ERC8183_JOB_STATES)[number];

export function erc8183JobState(value: number): Erc8183JobState {
  const state = ERC8183_JOB_STATES[value];
  if (state === undefined)
    throw new Error(`Unknown ERC-8183 job state: ${value}`);
  return state;
}

export interface CommerceTerms {
  chainId: number;
  commerceAddress: `0x${string}`;
  paymentToken: `0x${string}`;
  providerAddress: `0x${string}` | null;
  budget: bigint | null;
  source: "service-status" | "onchain-read";
}

export interface PreparedCommerceJob {
  provider: `0x${string}`;
  evaluator: `0x${string}`;
  expiresAt: bigint;
  description: string;
  hook: `0x${string}`;
  budget: bigint;
}

export interface CommerceProvider {
  getServiceTerms(): Promise<CommerceTerms>;
  prepareJob(input: PreparedCommerceJob): Promise<PreparedCommerceJob>;
  createJob(input: PreparedCommerceJob): Promise<bigint>;
  registerJob(jobId: bigint): Promise<`0x${string}`>;
  setBudget(jobId: bigint, amount: bigint): Promise<`0x${string}`>;
  fundJob(jobId: bigint, expectedBudget: bigint): Promise<`0x${string}`>;
  getJob(jobId: bigint): Promise<{ id: bigint; state: Erc8183JobState }>;
  submit(jobId: bigint, deliverable: `0x${string}`): Promise<`0x${string}`>;
  settle(jobId: bigint, evidence: `0x${string}`): Promise<`0x${string}`>;
  reject(jobId: bigint, reason: `0x${string}`): Promise<`0x${string}`>;
  claimRefund(jobId: bigint): Promise<`0x${string}`>;
}
