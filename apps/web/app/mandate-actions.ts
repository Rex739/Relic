"use server";

import type { CreateMandateRequest } from "@relic/domain";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createMandate,
  editMandate,
  getMandate,
  transitionMandate,
} from "../lib/mandates";

const capabilities = [
  "monitor_positions",
  "calculate_health_factor",
  "generate_alerts",
  "generate_recommendations",
];
const denied = [
  "transfer_tokens",
  "borrow_assets",
  "repay_debt",
  "swap_assets",
  "approve_contracts",
  "submit_transactions",
];
const fieldString = (formData: FormData, name: string, fallback = "") => {
  const value = formData.get(name);
  return typeof value === "string" ? value : fallback;
};

function healthFactorConfiguration(formData: FormData): CreateMandateRequest {
  const durationDays = Number(formData.get("durationDays") ?? 7);
  const threshold = fieldString(formData, "threshold", "1.30");
  const now = new Date();
  const enabledCapabilities = capabilities.filter(
    (capability) => formData.get(capability) === "on",
  );
  const monitoredAccount = fieldString(formData, "monitoredAccount");
  if (
    monitoredAccount.length > 0 &&
    !/^0x[0-9a-fA-F]{40}$/.test(monitoredAccount)
  )
    throw new Error("monitoredAccount must be a valid EVM address");
  return {
    agentId: fieldString(formData, "agentId"),
    chainId: Number(formData.get("chainId")) as 56 | 97,
    objective: fieldString(formData, "objective"),
    allowedCapabilities: enabledCapabilities,
    deniedCapabilities: denied,
    allowedAssets: [],
    allowedProtocols: ["Venus"],
    allowedContracts: [],
    perActionLimit: null,
    aggregateLimit: null,
    executionFrequency: null,
    startAt: now.toISOString(),
    expiresAt: new Date(
      now.getTime() + durationDays * 86_400_000,
    ).toISOString(),
    approvalMode: "OBSERVE_ONLY",
    riskConstraints: {
      alertHealthFactorBelow: threshold,
      ...(monitoredAccount.length === 0 ? {} : { monitoredAccount }),
    },
    stopConditions: [
      { kind: "SERVICE_STALE" },
      { kind: "MANDATE_EXPIRED" },
      { kind: "USER_PAUSED_OR_REVOKED" },
    ],
  };
}

export async function createAndReviewMandate(formData: FormData) {
  const draft = await createMandate(healthFactorConfiguration(formData));
  await transitionMandate(draft.id, "review");
  redirect(`/mandates/${draft.id}?preflight=passed`);
}

export async function createActivateMandateForHire(formData: FormData) {
  if (formData.get("explicitApproval") !== "approved")
    throw new Error("Explicit mandate approval is required");
  const draft = await createMandate(healthFactorConfiguration(formData));
  await transitionMandate(draft.id, "review");
  await transitionMandate(draft.id, "activate");
  const agentId = fieldString(formData, "agentId");
  const offerId = fieldString(formData, "offerId");
  redirect(
    `/agents/${encodeURIComponent(agentId)}/hire?offer=${encodeURIComponent(offerId)}&mandate=${encodeURIComponent(draft.id)}`,
  );
}

export async function activateMandateAction(id: string, formData: FormData) {
  if (formData.get("explicitApproval") !== "approved")
    throw new Error("Explicit mandate approval is required");
  await transitionMandate(id, "activate");
  revalidatePath(`/mandates/${id}`);
  revalidatePath("/my-agents");
  redirect(`/mandates/${id}?activated=true`);
}

export async function transitionMandateAction(
  id: string,
  action: "pause" | "resume" | "revoke",
) {
  await transitionMandate(id, action);
  revalidatePath(`/mandates/${id}`);
  revalidatePath("/my-agents");
}

export async function editMandateAction(id: string, formData: FormData) {
  const existing = await getMandate(id);
  const next = healthFactorConfiguration(formData);
  next.agentId = existing.agentId;
  next.chainId = existing.chainId;
  await editMandate(id, next);
  revalidatePath(`/mandates/${id}`);
  redirect(`/mandates/${id}?versioned=true`);
}
