import { NextResponse } from "next/server";

import { agreements, prepareCommerceValidation } from "../../../../../../lib/commerce";

export const dynamic = "force-dynamic";

const orderHref = (mandateId: string, checkoutError?: string) => {
  const path = `/account/my-hires/mandates/${encodeURIComponent(mandateId)}`;
  return checkoutError === undefined
    ? path
    : `${path}?checkoutError=${encodeURIComponent(checkoutError)}`;
};

/**
 * A native form endpoint for replacing a legacy checkout attempt. This avoids
 * relying on the React server-action transport to retain hidden form fields.
 */
export async function POST(
  request: Request,
  { params }: { params: Promise<{ mandateId: string }> },
) {
  const { mandateId } = await params;
  try {
    const agreement = (await agreements()).find(
      (item): item is NonNullable<typeof item> =>
        item !== null && item.mandateId === mandateId,
    );
    if (agreement === undefined)
      throw new Error("No active agreement was found for this order.");
    await prepareCommerceValidation(agreement.id);
    return NextResponse.redirect(new URL(orderHref(mandateId), request.url), 303);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Checkout is not ready yet.";
    return NextResponse.redirect(
      new URL(orderHref(mandateId, message), request.url),
      303,
    );
  }
}
