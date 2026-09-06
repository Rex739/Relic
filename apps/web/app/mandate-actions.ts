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
import {
  gridTradingCheckoutSchema,
  healthMonitoringCheckoutSchema,
  lpRangeRebalancingCheckoutSchema,
} from "../lib/checkout-input-validation";

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

async function serviceConfiguration(formData: FormData): Promise<CreateMandateRequest> {
  const durationDays = Number(formData.get("durationDays") ?? 14);
  const threshold = fieldString(formData, "threshold", "1.30");
  const now = new Date();
  const agentId = fieldString(formData, "agentId");
  const category = fieldString(formData, "category");
  const profile = await activationProfile(agentId);
  const isGridTrader = category === "grid-trading";
  const isLpRangeRebalancer = category === "rebalancing";
  const gridCapitalCap = fieldString(formData, "capitalCap");
  const gridLowerPrice = fieldString(formData, "lowerPrice");
  const gridUpperPrice = fieldString(formData, "upperPrice");
  const gridLevels = fieldString(formData, "gridLevels");
  const gridDurationHours = fieldString(formData, "durationHours");
  const gridValidation = isGridTrader
    ? gridTradingCheckoutSchema.safeParse({
        capitalCap: gridCapitalCap,
        lowerPrice: gridLowerPrice,
        upperPrice: gridUpperPrice,
        gridLevels,
        durationHours: gridDurationHours,
      })
    : null;
  if (gridValidation !== null && !gridValidation.success)
    throw new Error(gridValidation.error.issues[0]?.message ?? "Invalid grid settings");
  const validatedGrid = gridValidation?.success ? gridValidation.data : null;
  const rebalancingValidation = isLpRangeRebalancer
    ? lpRangeRebalancingCheckoutSchema.safeParse({
        positionTokenId: fieldString(formData, "positionTokenId"),
        capitalCap: fieldString(formData, "capitalCap"),
        rangeWidthBps: fieldString(formData, "rangeWidthBps"),
        durationHours: fieldString(formData, "durationHours"),
      })
    : null;
  if (rebalancingValidation !== null && !rebalancingValidation.success)
    throw new Error(
      rebalancingValidation.error.issues[0]?.message ??
        "Invalid LP rebalancing settings",
    );
  const validatedRebalancing = rebalancingValidation?.success
    ? rebalancingValidation.data
    : null;
  const healthValidation = category === "health-factor-monitoring"
    ? healthMonitoringCheckoutSchema.safeParse({
        threshold,
        durationDays: fieldString(formData, "durationDays", "14"),
      })
    : null;
  if (healthValidation !== null && !healthValidation.success)
    throw new Error(healthValidation.error.issues[0]?.message ?? "Invalid monitoring settings");
  const validatedHealth = healthValidation?.success ? healthValidation.data : null;
  const enabledCapabilities =
    profile.profile.capabilitySet.length > 0
      ? profile.profile.capabilitySet
      : capabilities.filter((capability) => formData.get(capability) === "on");
  const deniedCapabilities = denied.filter(
    (capability) => !enabledCapabilities.includes(capability),
  );
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
    deniedCapabilities,
    // A service input such as "USDT" is not proof that an agent is verified
    // for that asset. Keep it as task context until the offer publishes a
    // supported-asset schema.
    allowedAssets:
      validatedGrid === null && validatedRebalancing === null
        ? []
        : profile.profile.supportedAssets,
    allowedProtocols: profile.profile.supportedProtocols,
    allowedContracts:
      validatedRebalancing === null ? [] : profile.profile.supportedContracts,
    perActionLimit:
      validatedGrid === null && validatedRebalancing === null
        ? null
        : {
            asset: "TEST_USDT",
            amount:
              validatedGrid?.capitalCap ?? validatedRebalancing!.capitalCap,
          },
    aggregateLimit:
      validatedGrid === null && validatedRebalancing === null
        ? null
        : {
            asset: "TEST_USDT",
            amount:
              validatedGrid?.capitalCap ?? validatedRebalancing!.capitalCap,
          },
    executionFrequency:
      validatedGrid === null && validatedRebalancing === null
        ? null
        : validatedGrid !== null
          ? {
            maxActions: validatedGrid.gridLevels * 2,
            windowSeconds: validatedGrid.durationHours * 3_600,
          }
          : { maxActions: 1, windowSeconds: 3_600 },
    startAt: now.toISOString(),
    expiresAt: new Date(
      now.getTime() +
        (validatedGrid !== null
          ? validatedGrid.durationHours * 3_600_000
          : validatedRebalancing !== null
            ? validatedRebalancing.durationHours * 3_600_000
            : (validatedHealth?.durationDays ?? durationDays) * 86_400_000),
    ).toISOString(),
    approvalMode: isGridTrader || isLpRangeRebalancer
      ? "PRE_AUTHORIZED"
      : profile.profile.approvalModes.includes("OBSERVE_ONLY")
        ? "OBSERVE_ONLY"
        : profile.profile.approvalModes[0]!,
    riskConstraints: {
      ...(category === "health-factor-monitoring"
        ? { alertHealthFactorBelow: validatedHealth?.threshold ?? threshold }
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
            gridLevels: validatedGrid.gridLevels,
            durationHours: validatedGrid.durationHours,
            minimumSecondsBetweenExecutions: 900,
          }),
      ...(validatedRebalancing === null
        ? {}
        : {
            market: "WBNB/TEST_USDT",
            positionTokenId: validatedRebalancing.positionTokenId,
            capitalCap: validatedRebalancing.capitalCap,
            rangeWidthBps: validatedRebalancing.rangeWidthBps,
            durationHours: validatedRebalancing.durationHours,
            minimumSecondsBetweenRebalances: 3_600,
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

/** Creates a reviewed rebalancing mandate. It deliberately does not activate
 * the mandate or create a paid agreement; the buyer's Altana grant must be
 * verified first. */
export async function prepareRebalancingAuthorization(formData: FormData) {
  if (fieldString(formData, "category") !== "rebalancing")
    throw new Error("This authorization flow is only for LP rebalancing.");
  if (formData.get("explicitApproval") !== "approved")
    throw new Error("Explicit mandate approval is required");
  const draft = await createMandate(await serviceConfiguration(formData));
  await transitionMandate(draft.id, "review");
  return { mandateId: draft.id };
}

/** Runs only after the API verified the buyer-owned Altana grant and activated
 * the matching mandate. */
export async function startHireCheckoutForAuthorizedMandate(input: {
  mandateId: string;
  offerId: string;
}) : Promise<StartedHireCheckout> {
  const createdAgreement = await hireOffer(input.offerId, input.mandateId);
  const agreementId = typeof createdAgreement.id === "string" ? createdAgreement.id : "";
  if (!agreementId) throw new Error("Agreement creation returned no identifier");
  const agreementTermsHash =
    typeof createdAgreement.termsHash === "string" ? createdAgreement.termsHash : "";
  if (!agreementTermsHash) throw new Error("Agreement creation returned no terms hash");
  await acceptTerms(agreementId, agreementTermsHash);
  return { mandateId: input.mandateId, agreementId };
}

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
  if (fieldString(formData, "category") === "rebalancing")
    throw new Error("Authorize the buyer-owned trading permission before starting LP rebalancing checkout.");
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
