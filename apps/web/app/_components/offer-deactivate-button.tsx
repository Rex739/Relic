"use client";

import { useTransition } from "react";
import { toast } from "sonner";

export function OfferDeactivateButton({
  action,
  label,
}: {
  action: () => Promise<void>;
  label: "Deactivate" | "Discard draft";
}) {
  const [pending, startTransition] = useTransition();

  return (
    <button
      className="danger-link"
      disabled={pending}
      onClick={() =>
        startTransition(async () => {
          try {
            await action();
            toast.success(
              label === "Deactivate" ? "Offer deactivated" : "Draft discarded",
              {
                description:
                  label === "Deactivate"
                    ? "The offer is no longer available to buyers."
                    : "The draft was removed from current offers.",
              },
            );
          } catch {
            toast.error("Offer could not be updated", {
              description: "Try again in a moment.",
            });
          }
        })
      }
      type="button"
    >
      {pending ? "Updating…" : label}
    </button>
  );
}
