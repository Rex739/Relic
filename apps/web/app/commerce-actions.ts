"use server";

import { redirect } from "next/navigation";

import {
  acceptTerms,
  cancelAgreement,
  hireOffer,
  revokeAgreementAuthorization,
} from "../lib/commerce";

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  if (typeof value !== "string" || value.length === 0)
    throw new Error(`${name} is required`);
  return value;
};

export async function hireOfferAction(formData: FormData) {
  const offerId = field(formData, "offerId");
  const mandateId = field(formData, "mandateId");
  const result = await hireOffer(offerId, mandateId);
  const agreementId = typeof result.id === "string" ? result.id : "";
  if (agreementId.length === 0)
    throw new Error("Agreement creation returned no identifier");
  redirect(`/commerce/agreements/${agreementId}`);
}

export async function acceptTermsAction(formData: FormData) {
  const agreementId = field(formData, "agreementId");
  const termsHash = field(formData, "termsHash");
  await acceptTerms(agreementId, termsHash);
  redirect(`/commerce/agreements/${agreementId}`);
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
