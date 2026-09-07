"use client";

import { useState, useTransition } from "react";

export function ActivateOfferButton({
  action,
}: {
  action: () => Promise<{ error: string | null }>;
}) {
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  return (
    <span>
      <button
        disabled={pending}
        onClick={() =>
          startTransition(async () => setError((await action()).error))
        }
        type="button"
      >
        {pending ? "Checking…" : "Activate"}
      </button>
      {error === null ? null : <small role="alert">{error}</small>}
    </span>
  );
}
