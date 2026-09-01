"use client";

import { Tag } from "lucide-react";
import { useState, useTransition } from "react";

import { Button } from "../../components/ui/button";

type EditableOffer = {
  agentId: string;
  serviceId: string;
  capability: string;
  billingModel: string;
  chainId: number;
  price: {
    amount: string;
    decimals: number;
    tokenAddress: string;
    symbol: string;
  };
  capabilities: string;
  terms: string;
  limitations: string;
};

export function OfferDetailsEditor({
  action,
  offer,
}: {
  action: (formData: FormData) => Promise<void>;
  offer: EditableOffer;
}) {
  const [pending, startTransition] = useTransition();
  const [terms, setTerms] = useState(offer.terms);
  const [limitations, setLimitations] = useState(offer.limitations);
  const [savedTerms, setSavedTerms] = useState(offer.terms);
  const [savedLimitations, setSavedLimitations] = useState(offer.limitations);
  const [error, setError] = useState<string | null>(null);
  const hasChanges = terms !== savedTerms || limitations !== savedLimitations;

  return (
    <details>
      <summary>Edit offer</summary>
      <form
        action={(formData) =>
          startTransition(async () => {
            setError(null);
            try {
              await action(formData);
              setSavedTerms(terms);
              setSavedLimitations(limitations);
            } catch (caught) {
              setError(
                caught instanceof Error
                  ? caught.message
                  : "Unable to save your changes. Try again.",
              );
            }
          })
        }
        className="commerce-form seller-profile-form offer-profile-form"
      >
        <input name="agentId" type="hidden" value={offer.agentId} />
        <input name="serviceId" type="hidden" value={offer.serviceId} />
        <input name="chainId" type="hidden" value={offer.chainId} />
        <input name="capability" type="hidden" value={offer.capability} />
        <input name="billingModel" type="hidden" value={offer.billingModel} />
        <input name="price" type="hidden" value={offer.price.amount} />
        <input name="decimals" type="hidden" value={offer.price.decimals} />
        <input
          name="tokenAddress"
          type="hidden"
          value={offer.price.tokenAddress}
        />
        <input name="symbol" type="hidden" value={offer.price.symbol} />
        <input name="capabilities" type="hidden" value={offer.capabilities} />
        <div className="offer-form-marker" aria-hidden="true">
          <Tag size={24} />
        </div>
        <div className="seller-profile-fields">
          <div className="offer-verified-price">
            <span>Verified price</span>
            <strong>
              {offer.price.amount} {offer.price.symbol} per execution
            </strong>
            <small>
              Set by the verified service and kept in sync with its marketplace
              offer.
            </small>
          </div>
          <label>
            What the buyer receives
            <textarea
              name="terms"
              onChange={(event) => setTerms(event.target.value)}
              required
              value={terms}
            />
            <small>
              Describe the result, scope, and delivery a buyer can expect.
            </small>
          </label>
          <label>
            Limitations buyers should know
            <textarea
              name="limitations"
              onChange={(event) => setLimitations(event.target.value)}
              value={limitations}
            />
            <small>Include any important boundaries or exclusions.</small>
          </label>
          <Button disabled={pending || !hasChanges} type="submit">
            {pending ? "Saving…" : "Save changes"}
          </Button>
          {error === null ? null : <small role="alert">{error}</small>}
        </div>
      </form>
    </details>
  );
}
