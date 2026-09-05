"use server";

import type { CreateMandateRequest } from "@relic/domain";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  createMandate,
  editMandate,
  getMandate,
  transitionMandate,
  activationProfile,
} from "../lib/mandates";
import { acceptTerms, hireOffer } from "../lib/commerce";

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

const positiveDecimal = (value: string, label: string) => {
  if (!/^\d+(?:\.\d+)?$/u.test(value))
    throw new Error(`${label} must be a positive number`);
  const [whole, fraction = ""] = value.split(".");
  if (fraction.length > 18 || BigInt(`${whole}${fraction.padEnd(18, "0")}`) <= 0n)
    throw new Error(`${label} must be a positive number with at most 18 decimal places`);
  return value;
};

const decimalUnits = (value: string) => {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(`${whole}${fraction.padEnd(18, "0")}`);
};

const wholeNumberInRange = (
  value: string,
  label: string,
  minimum: number,
  maximum: number,
) => {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum)
    throw new Error(`${label} must be a whole number between ${minimum} and ${maximum}`);
  return parsed;
};

async function serviceConfiguration(formData: FormData): Promise<CreateMandateRequest> {
  const durationDays = Number(formData.get("durationDays") ?? 14);
  const threshold = fieldString(formData, "threshold", "1.30");
  const now = new Date();
  const agentId = fieldString(formData, "agentId");
  const category = fieldString(formData, "category");
  const profile = await activationProfile(agentId);
  const isGridTrader = category === "grid-trading";
  const gridCapitalCap = fieldString(formData, "capitalCap");
  const gridLowerPrice = fieldString(formData, "lowerPrice");
  const gridUpperPrice = fieldString(formData, "upperPrice");
  const gridLevels = fieldString(formData, "gridLevels");
  const gridDurationHours = fieldString(formData, "durationHours");
  const validatedGrid = isGridTrader
    ? {
        capitalCap: positiveDecimal(gridCapitalCap, "Maximum trading capital"),
        lowerPrice: positiveDecimal(gridLowerPrice, "Lower price"),
        upperPrice: positiveDecimal(gridUpperPrice, "Upper price"),
        levels: wholeNumberInRange(gridLevels, "Grid levels", 5, 8),
        durationHours: wholeNumberInRange(
          gridDurationHours,
          "Run time",
          1,
          168,
        ),
      }
    : null;
  if (
    validatedGrid !== null &&
    decimalUnits(validatedGrid.upperPrice) <=
      decimalUnits(validatedGrid.lowerPrice)
  )
    throw new Error("Upper price must be greater than lower price");
  const enabledCapabilities =
    profile.profile.capabilitySet.length > 0
      ? profile.profile.capabilitySet
      : capabilities.filter((capability) => formData.get(capability) === "on");
  const monitoredAccount = fieldString(formData, "publicAccount");
  if (
    monitoredAccount.length > 0 &&
    !/^0x[0-9a-fA-F]{40}$/.test(monitoredAccount)
  )
    throw new Error("monitoredAccount must be a valid EVM address");
  return {
    agentId,
    chainId: profile.profile.chainId,
    objective: fieldString(
      formData,
      "objective",
      category === "health-factor-monitoring"
        ? "Monitor my public lending position and alert me when attention is needed."
        : `Run the requested ${category.replaceAll("-", " ")} service.`,
    ),
    allowedCapabilities: enabledCapabilities,
    deniedCapabilities: denied,
    // A service input such as "USDT" is not proof that an agent is verified
    // for that asset. Keep it as task context until the offer publishes a
    // supported-asset schema.
    allowedAssets: validatedGrid === null ? [] : ["TEST_USDT", "WBNB"],
    allowedProtocols: profile.profile.supportedProtocols,
    allowedContracts: [],
    perActionLimit:
      validatedGrid === null
        ? null
        : { asset: "TEST_USDT", amount: validatedGrid.capitalCap },
    aggregateLimit:
      validatedGrid === null
        ? null
        : { asset: "TEST_USDT", amount: validatedGrid.capitalCap },
    executionFrequency:
      validatedGrid === null
        ? null
        : {
            maxActions: validatedGrid.levels * 2,
            windowSeconds: validatedGrid.durationHours * 3_600,
          },
    startAt: now.toISOString(),
    expiresAt: new Date(
      now.getTime() +
        (validatedGrid === null
          ? durationDays * 86_400_000
          : validatedGrid.durationHours * 3_600_000),
    ).toISOString(),
    approvalMode: profile.profile.approvalModes.includes("OBSERVE_ONLY")
      ? "OBSERVE_ONLY"
      : profile.profile.approvalModes[0]!,
    riskConstraints: {
      ...(category === "health-factor-monitoring"
        ? { alertHealthFactorBelow: threshold }
        : {}),
      ...(fieldString(formData, "target") === ""
        ? {}
        : { target: fieldString(formData, "target") }),
      ...(fieldString(formData, "asset") === ""
        ? {}
        : { requestedAsset: fieldString(formData, "asset") }),
      ...(monitoredAccount.length === 0 ? {} : { monitoredAccount }),
      ...(validatedGrid === null
        ? {}
        : {
            market: "WBNB/TEST_USDT",
            capitalCap: validatedGrid.capitalCap,
            lowerPrice: validatedGrid.lowerPrice,
            upperPrice: validatedGrid.upperPrice,
            gridLevels: validatedGrid.levels,
            durationHours: validatedGrid.durationHours,
            minimumSecondsBetweenExecutions: 900,
          }),
    },
    stopConditions: [
      { kind: "SERVICE_STALE" },
      { kind: "MANDATE_EXPIRED" },
      { kind: "USER_PAUSED_OR_REVOKED" },
    ],
  };
}

export async function createAndReviewMandate(formData: FormData) {
  const draft = await createMandate(await serviceConfiguration(formData));
  await transitionMandate(draft.id, "review");
  redirect(`/mandates/${draft.id}?preflight=passed`);
}

export type StartedHireCheckout = {
  mandateId: string;
  agreementId: string;
};

/**
 * Starts the checkout without navigating away from the service card. The
 * browser still has to collect the buyer's EIP-712 signature afterwards, but
 * that happens in the checkout dialog rather than in the retired hire wizard.
 */
export async function startHireCheckout(
  formData: FormData,
): Promise<StartedHireCheckout> {
  if (formData.get("explicitApproval") !== "approved")
    throw new Error("Explicit mandate approval is required");
  const draft = await createMandate(await serviceConfiguration(formData));
  await transitionMandate(draft.id, "review");
  await transitionMandate(draft.id, "activate");
  const offerId = fieldString(formData, "offerId");
  // Create the required Relic agreement in the same checkout submission. The
  // buyer still signs the EIP-712 authorization in their wallet on the next
  // screen; it cannot safely be performed by the server.
  const createdAgreement = await hireOffer(offerId, draft.id);
  const agreementId = typeof createdAgreement.id === "string" ? createdAgreement.id : "";
  if (!agreementId) throw new Error("Agreement creation returned no identifier");
  const agreementTermsHash =
    typeof createdAgreement.termsHash === "string" ? createdAgreement.termsHash : "";
  if (!agreementTermsHash) throw new Error("Agreement creation returned no terms hash");
  await acceptTerms(agreementId, agreementTermsHash);
  return { mandateId: draft.id, agreementId };
}

export async function createActivateMandateForHire(formData: FormData) {
  const started = await startHireCheckout(formData);
  const agentId = fieldString(formData, "agentId");
  const offerId = fieldString(formData, "offerId");
  redirect(
    `/agents/${encodeURIComponent(agentId)}/hire?offer=${encodeURIComponent(offerId)}&mandate=${encodeURIComponent(started.mandateId)}&agreement=${encodeURIComponent(started.agreementId)}&autoAuthorize=1`,
  );
}

export async function removeSavedHireSetup(formData: FormData) {
  const mandateId = fieldString(formData, "mandateId");
  const agentId = fieldString(formData, "agentId");
  const offerId = fieldString(formData, "offerId");
  if (!mandateId || !agentId || !offerId)
    throw new Error("Saved setup details are required");
  await transitionMandate(mandateId, "revoke");
  revalidatePath("/account/my-hires");
  revalidatePath(`/account/my-hires/mandates/${mandateId}`);
  revalidatePath(`/agents/${agentId}/hire`);
  redirect(
    `/agents/${encodeURIComponent(agentId)}/hire?offer=${encodeURIComponent(offerId)}`,
  );
}

export async function activateMandateAction(id: string, formData: FormData) {
  if (formData.get("explicitApproval") !== "approved")
    throw new Error("Explicit mandate approval is required");
  await transitionMandate(id, "activate");
  revalidatePath(`/mandates/${id}`);
  revalidatePath("/account/my-hires");
  redirect(`/mandates/${id}?activated=true`);
}

export async function transitionMandateAction(
  id: string,
  action: "pause" | "resume" | "revoke",
) {
  await transitionMandate(id, action);
  revalidatePath(`/mandates/${id}`);
  revalidatePath("/account/my-hires");
}

export async function editMandateAction(id: string, formData: FormData) {
  const existing = await getMandate(id);
  const next = await serviceConfiguration(formData);
  next.agentId = existing.agentId;
  next.chainId = existing.chainId;
  await editMandate(id, next);
  revalidatePath(`/mandates/${id}`);
  redirect(`/mandates/${id}?versioned=true`);
}
