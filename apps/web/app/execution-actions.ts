"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { getMandate, listExecutions, requestExecution } from "../lib/mandates";

const createHealthObservation = async (mandateId: string, account: string) => {
  const mandate = await getMandate(mandateId);
  return requestExecution(mandateId, `health-observation:${randomUUID()}`, {
    mandateId,
    mandateVersion: mandate.currentVersion,
    agentId: mandate.agentId,
    chainId: mandate.chainId,
    actionType: "observe_venus_position",
    capability: "monitor_positions",
    protocol: "Venus",
    target: null,
    asset: null,
    amount: null,
    destination: null,
    parameters: { account },
    deadline: new Date(Date.now() + 5 * 60_000).toISOString(),
    source: { kind: "execution_room_user_request" },
  });
};

const pancakeV3PositionManager =
  "0x427bF5b37357632377eCbEC9de3626C71A5396c1";

/**
 * Starts one buyer-authorized PancakeSwap V3 rebalance attempt. The API—not
 * this server action—owns the policy decision, cooldown, encrypted session,
 * live pool checks, and transaction submission.
 */
export async function requestLpRebalance(mandateId: string) {
  const mandate = await getMandate(mandateId);
  const constraints = mandate.version.riskConstraints;
  const positionTokenId = constraints.positionTokenId;
  const capitalCap = constraints.capitalCap;
  const rangeWidthBps = constraints.rangeWidthBps;
  if (
    typeof positionTokenId !== "string" ||
    !/^[1-9]\d*$/u.test(positionTokenId) ||
    typeof capitalCap !== "string" ||
    !/^\d+(?:\.\d+)?$/u.test(capitalCap) ||
    typeof rangeWidthBps !== "number" ||
    !Number.isInteger(rangeWidthBps)
  )
    throw new Error("This LP mandate is missing its verified rebalance settings.");
  await requestExecution(mandateId, `lp-rebalance:${randomUUID()}`, {
    mandateId,
    mandateVersion: mandate.currentVersion,
    agentId: mandate.agentId,
    chainId: 97,
    actionType: "rebalance_liquidity",
    capability: "submit_transactions",
    protocol: "PancakeSwap",
    target: pancakeV3PositionManager,
    asset: "TEST_USDT",
    amount: capitalCap,
    destination: null,
    parameters: { positionTokenId, rangeWidthBps, maxSlippageBps: 50 },
    deadline: new Date(Date.now() + 10 * 60_000).toISOString(),
    source: { kind: "execution_room_lp_rebalance" },
  });
  revalidatePath(`/account/my-hires/${mandateId}`);
  revalidatePath(`/account/my-hires/mandates/${mandateId}`);
  revalidatePath("/account/my-hires");
}

export async function requestHealthObservation(
  mandateId: string,
  formData: FormData,
) {
  const account = formData.get("account");
  if (typeof account !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(account))
    throw new Error("A valid public BSC observation address is required");
  await createHealthObservation(mandateId, account);
  revalidatePath(`/account/my-hires/${mandateId}`);
  revalidatePath(`/account/my-hires/mandates/${mandateId}`);
  revalidatePath("/account/my-hires");
}

export async function startInitialHealthObservation(mandateId: string) {
  const mandate = await getMandate(mandateId);
  const account = mandate.version.riskConstraints.monitoredAccount;
  if (typeof account !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(account))
    throw new Error("This order has no valid public account to monitor");

  // Client transitions and retries can both invoke this action. A first check
  // is an order bootstrap, never a recurring user command, so it is idempotent.
  const existing = await listExecutions(mandateId);
  const execution = existing[0] ?? (await createHealthObservation(mandateId, account));
  revalidatePath(`/account/my-hires/${mandateId}`);
  revalidatePath(`/account/my-hires/mandates/${mandateId}`);
  revalidatePath("/account/my-hires");
  return execution;
}

export async function requestForbiddenTransfer(
  mandateId: string,
  formData: FormData,
) {
  const mandate = await getMandate(mandateId);
  const destination = formData.get("destination");
  if (
    typeof destination !== "string" ||
    !/^0x[0-9a-fA-F]{40}$/.test(destination)
  )
    throw new Error("A valid public BSC destination address is required");
  await requestExecution(mandateId, `forbidden-transfer:${randomUUID()}`, {
    mandateId,
    mandateVersion: mandate.currentVersion,
    agentId: mandate.agentId,
    chainId: mandate.chainId,
    actionType: "TOKEN_TRANSFER",
    capability: "transfer_tokens",
    protocol: "Venus",
    target: null,
    asset: "TBNB",
    amount: null,
    destination,
    parameters: { validationOnly: true },
    deadline: new Date(Date.now() + 5 * 60_000).toISOString(),
    source: { kind: "execution_room_forbidden_action_validation" },
  });
  revalidatePath(`/account/my-hires/${mandateId}`);
  revalidatePath(`/account/my-hires/mandates/${mandateId}`);
  revalidatePath("/account/my-hires");
}
