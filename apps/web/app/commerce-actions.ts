"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  acceptTerms,
  cancelAgreement,
  createCommerceActivation,
  hireOffer,
  prepareCommerceValidation,
  revokeAgreementAuthorization,
} from "../lib/commerce";

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${name} is required`);
  return value;
};

const safeContinuation = (value: FormDataEntryValue | null) =>
  typeof value === "string" && value.startsWith("/") && !value.startsWith("//")
    ? value
    : null;

export async function hireOfferAction(formData: FormData) {
  const offerId = field(formData, "offerId");
  const mandateId = field(formData, "mandateId");
  const result = await hireOffer(offerId, mandateId);
  const agreementId = typeof result.id === "string" ? result.id : "";
  if (agreementId.length === 0)
    throw new Error("Agreement creation returned no identifier");
  const continuation = safeContinuation(formData.get("continuation"));
  redirect(
    continuation !== null
      ? `${continuation}${continuation.includes("?") ? "&" : "?"}agreement=${encodeURIComponent(agreementId)}`
      : `/commerce/agreements/${agreementId}`,
  );
}

export async function acceptTermsAction(formData: FormData) {
  const agreementId = field(formData, "agreementId");
  const termsHash = field(formData, "termsHash");
  await acceptTerms(agreementId, termsHash);
  const continuation = safeContinuation(formData.get("continuation"));
  redirect(
    continuation !== null
      ? `${continuation}${continuation.includes("?") ? "&" : "?"}autoAuthorize=1`
      : `/commerce/agreements/${agreementId}?autoAuthorize=1`,
  );
}

export async function cancelAgreementAction(formData: FormData) {
  const agreementId = field(formData, "agreementId");
  await cancelAgreement(agreementId);
  redirect(`/commerce/agreements/${agreementId}`);
}

export async function revokeAuthorizationAction(formData: FormData) {
  const agreementId = field(formData, "agreementId");
  await revokeAgreementAuthorization(agreementId);
  redirect(`/commerce/agreements/${agreementId}`);
}

export async function prepareCommerceValidationAction(formData: FormData) {
  const agreementId = field(formData, "agreementId");
  await prepareCommerceValidation(agreementId);
  redirect(`/commerce/agreements/${agreementId}`);
}

export async function prepareCommerceActivationAction(formData: FormData) {
  const agreementId = field(formData, "agreementId");
  const executionRequestId = field(formData, "executionRequestId");
  const authorizationId = field(formData, "authorizationId");
  await createCommerceActivation(
    agreementId,
    executionRequestId,
    authorizationId,
  );
  const mandateId = formData.get("mandateId");
  redirect(
    typeof mandateId === "string" && mandateId.length > 0
      ? `/account/my-hires/mandates/${mandateId}`
      : `/commerce/agreements/${agreementId}`,
  );
}

/** Replace an unsigned legacy setup attempt with the current checkout flow. */
export async function restartSecureCheckoutAction(
  agreementId: string,
  mandateId: string,
) {
  try {
    await prepareCommerceValidation(agreementId);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Checkout is not ready yet.";
    redirect(
      `/account/my-hires/mandates/${mandateId}?checkoutError=${encodeURIComponent(message)}`,
    );
  }
  revalidatePath(`/account/my-hires/mandates/${mandateId}`);
  redirect(`/account/my-hires/mandates/${mandateId}`);
}

/** Complete the checkout hand-off after its single exact-action signature. */
export async function completeHireCheckoutActivation(input: {
  agreementId: string;
  mandateId: string;
}) {
  // The exact signature has already authorized the agreement and the first
  // read-only validation. From here, use the offer-bound ERC-8183 sequence so
  // the service's quoted price—not a legacy zero-price bootstrap job—is what
  // the buyer sees and funds in escrow.
  const agreement = await prepareCommerceValidation(input.agreementId);
  const operation = agreement.operations.find((candidate) => {
    const evidence = candidate.evidence as Record<string, unknown> | undefined;
    return (
      candidate.state === "AWAITING_SIGNATURE" &&
      evidence?.commerceValidation === true &&
      evidence.quote !== null &&
      typeof evidence.quote === "object"
    );
  });
  const supportedOperationTypes = [
    "APPROVE_TOKEN",
    "CREATE_JOB",
    "REGISTER_JOB",
    "SET_BUDGET",
    "FUND",
  ] as const;
  if (
    operation === undefined ||
    typeof operation.id !== "string" ||
    !supportedOperationTypes.includes(
      operation.operationType as (typeof supportedOperationTypes)[number],
    )
  )
    throw new Error("Relic could not prepare the offer-bound service request.");
  revalidatePath(`/account/my-hires/mandates/${input.mandateId}`);
  revalidatePath("/account/my-hires");
  return {
    operationId: operation.id,
    operationType: operation.operationType as (typeof supportedOperationTypes)[number],
    operationState: "AWAITING_SIGNATURE" as const,
  };
}
