"use server";

import { randomUUID } from "node:crypto";

import { revalidatePath } from "next/cache";

import { getMandate, requestExecution } from "../lib/mandates";

export async function requestHealthObservation(
  mandateId: string,
  formData: FormData,
) {
  const mandate = await getMandate(mandateId);
  const account = formData.get("account");
  if (typeof account !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(account))
    throw new Error("A valid public BSC observation address is required");
  await requestExecution(mandateId, `health-observation:${randomUUID()}`, {
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
  revalidatePath(`/my-agents/${mandateId}`);
  revalidatePath("/my-agents");
}
