"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import {
  parseBaseUnits,
  sellerMarketplaceProfileInputSchema,
  type CreateOfferRequest,
} from "@relic/domain";

import {
  createOperatorOffer,
  createOperatorValidationSession,
  reviseOperatorOffer,
  transitionOperatorOffer,
  updateOperatorAgentProfile,
  updateOperatorServiceEndpoint,
  requestOperatorServiceVerification,
  requestInternalServiceVerification,
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

export type CreateOfferActionResult = { error: string | null };

export async function updateSellerProfileAction(
  agentId: string,
  formData: FormData,
): Promise<CreateOfferActionResult> {
  try {
    const profile = sellerMarketplaceProfileInputSchema.parse({
      description: field(formData, "description"),
      imageUrl: field(formData, "imageUrl"),
    });
    await updateOperatorAgentProfile(agentId, profile);
    revalidatePath("/marketplace");
    revalidatePath("/account/mylistings");
    revalidatePath(`/agents/${agentId}`);
    return { error: null };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to update the marketplace profile. Try again.",
    };
  }
}

export async function updateSellerServiceEndpointAction(
  agentId: string,
  serviceId: string,
  formData: FormData,
): Promise<CreateOfferActionResult> {
  try {
    await updateOperatorServiceEndpoint(
      agentId,
      serviceId,
      field(formData, "serviceEndpoint"),
    );
    revalidatePath("/account/mylistings");
    revalidatePath("/marketplace");
    return { error: null };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to update the service endpoint. Try again.",
    };
  }
}

export async function requestSellerServiceVerificationAction(
  agentId: string,
  serviceId: string,
): Promise<CreateOfferActionResult & { queued?: boolean }> {
  try {
    const result = await requestOperatorServiceVerification(agentId, serviceId);
    revalidatePath("/account/mylistings");
    return { error: null, queued: result.queued };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to request verification. Try again.",
    };
  }
}

export async function requestInternalServiceVerificationAction(
  serviceId: string,
): Promise<CreateOfferActionResult & { queued?: boolean }> {
  try {
    const result = await requestInternalServiceVerification(serviceId);
    revalidatePath("/internal/verifications");
    return { error: null, queued: result.queued };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to queue verification. Try again.",
    };
  }
}

export async function createOfferAction(
  formData: FormData,
): Promise<CreateOfferActionResult> {
  try {
    await createOperatorOffer(offerRequest(formData));
    revalidatePath("/operator/offers");
    revalidatePath("/account/mylistings");
    return { error: null };
  } catch (error) {
    return {
      error:
        error instanceof Error
          ? error.message
          : "Unable to save the offer draft. Try again.",
    };
  }
}

export async function reviseOfferAction(id: string, formData: FormData) {
  await reviseOperatorOffer(id, offerRequest(formData));
  revalidatePath("/operator/offers");
  revalidatePath("/account/mylistings");
}

export async function transitionOfferAction(
  id: string,
  action: "activate" | "pause" | "deactivate",
) {
  await transitionOperatorOffer(id, action);
  revalidatePath("/operator/offers");
  revalidatePath("/account/mylistings");
}

export async function startCommerceValidationAction(offerId: string) {
  const handoff = await createOperatorValidationSession(offerId);
  redirect(
    `/commerce-validation/${encodeURIComponent(handoff.session.id)}?token=${encodeURIComponent(handoff.handoffToken)}`,
  );
}
