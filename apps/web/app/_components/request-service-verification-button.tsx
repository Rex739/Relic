"use client";

import { useState, useTransition } from "react";

import { Button } from "../../components/ui/button";

export function RequestServiceVerificationButton({
  action,
}: {
  action: () => Promise<{ error: string | null; queued?: boolean }>;
}) {
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);
  return (
    <div className="seller-profile-actions">
      <Button
        disabled={pending}
        onClick={() =>
          startTransition(async () => {
            setMessage(null);
            const result = await action();
            setMessage(
              result.error ??
                (result.queued === false
                  ? "Already queued."
                  : "Verification queued."),
            );
          })
        }
        size="sm"
        type="button"
        variant="outline"
      >
        {pending ? "Queueing…" : "Run verification"}
      </Button>
      {message === null ? null : <span role="status">{message}</span>}
    </div>
  );
}
