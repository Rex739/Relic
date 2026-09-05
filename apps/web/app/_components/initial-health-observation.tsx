"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { startInitialHealthObservation } from "../execution-actions";

export function InitialHealthObservation({ mandateId }: { mandateId: string }) {
  const router = useRouter();
  const started = useRef(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    void startInitialHealthObservation(mandateId)
      .then(() => {
        const destination = new URL(window.location.href);
        destination.searchParams.delete("start");
        router.replace(`${destination.pathname}${destination.search}`);
        router.refresh();
      })
      .catch((caught) =>
        setError(
          caught instanceof Error
            ? caught.message
            : "Relic could not prepare the first service update.",
        ),
      );
  }, [mandateId, router]);

  if (error !== null)
    return <p role="alert">{error}. Refresh this order to retry automatically.</p>;

  // The order status already communicates that the first update is pending.
  // Do not introduce a second, agent-specific progress message or imply the
  // buyer needs to do anything while this read-only bootstrap runs.
  return null;
}
