"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";

import { Button } from "../../components/ui/button";
const failureCopy = (error: string) => {
  if (error.includes("Provider card request failed"))
    return {
      title: "Agent card could not be reached",
      detail:
        "Relic could not read the public agent card needed for the quote-only activation check.",
    };
  if (error.includes("Provider negotiation failed"))
    return {
      title: "Agent did not return a quote",
      detail:
        "Relic reached the agent, but it could not confirm this exact offer price and terms.",
    };
  return {
    title: "Activation check failed",
    detail: "Relic could not complete the quote-only check for this offer.",
  };
};

export function ActivateOfferButton({
  action,
}: {
  action: () => Promise<{ error: string | null }>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const failure = error === null ? null : failureCopy(error);

  return (
    <div className="activation-control">
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            const result = await action();
            setError(result.error);
            if (result.error === null)
              toast.success("Offer activated", {
                description: "The offer is live and ready for buyers.",
              });
          })
        }
        type="button"
        variant="outline"
      >
        {pending ? "Checking…" : "Activate"}
      </Button>
      {failure === null ? null : (
        <div className="activation-failure" role="alert">
          <strong>{failure.title}</strong>
          <span>{failure.detail}</span>
          <small>
            No buyer job, payment, or transaction was created. Edit offer only
            if you want to change its terms, then retry.
          </small>
          <details>
            <summary>Technical detail</summary>
            <small>{error}</small>
          </details>
        </div>
      )}
    </div>
  );
}
