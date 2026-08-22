"use server";

import { revalidatePath } from "next/cache";

import { parseBaseUnits, type CreateOfferRequest } from "@relic/domain";

import {
  createOperatorOffer,
  reviseOperatorOffer,
  transitionOperatorOffer,
} from "../lib/commerce";

const field = (formData: FormData, name: string) => {
  const value = formData.get(name);
  if (typeof value !== "string") throw new Error(`${name} is required`);
  return value;
};

const offerRequest = (formData: FormData): CreateOfferRequest => {
  const decimals = Number(formData.get("decimals"));
  const amountBaseUnits = parseBaseUnits(
    field(formData, "price"),
    decimals,
  ).toString();
  const chainId = Number(formData.get("chainId"));
  if (chainId !== 56 && chainId !== 97) throw new Error("Unsupported chain");
  return {
    agentId: field(formData, "agentId"),
    serviceId: field(formData, "serviceId"),
    chainId,
    capability: field(formData, "capability"),
    billingModel: field(formData, "billingModel") as
      "ONE_TIME" | "PER_EXECUTION" | "SUBSCRIPTION",
    price: {
      chainId,
      tokenAddress: field(formData, "tokenAddress"),
      decimals,
      amountBaseUnits,
      symbol: field(formData, "symbol"),
    },
    terms: field(formData, "terms"),
    capabilitySnapshot: field(formData, "capabilities")
      .split(",")
      .map((item) => item.trim())
      .filter(Boolean),
    limitationsSnapshot: field(formData, "limitations")
      .split("\n")
      .map((item) => item.trim())
      .filter(Boolean),
    effectiveAt: new Date().toISOString(),
    expiresAt: null,
  };
};

export async function createOfferAction(formData: FormData) {
  await createOperatorOffer(offerRequest(formData));
  revalidatePath("/operator/offers");
}

export async function reviseOfferAction(id: string, formData: FormData) {
  await reviseOperatorOffer(id, offerRequest(formData));
  revalidatePath("/operator/offers");
}

export async function transitionOfferAction(
  id: string,
  action: "activate" | "pause" | "deactivate",
) {
  await transitionOperatorOffer(id, action);
  revalidatePath("/operator/offers");
}
