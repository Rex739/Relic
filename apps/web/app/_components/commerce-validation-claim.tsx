"use client";

import Link from "next/link";
import { useState } from "react";

import { useRelicWallet } from "./relic-wallet-provider";

export function CommerceValidationClaim({
  sessionId,
  handoffToken,
}: {
  sessionId: string;
  handoffToken: string;
}) {
  const wallet = useRelicWallet();
  const [stage, setStage] = useState<"idle" | "claiming" | "claimed">("idle");
  const [agreementId, setAgreementId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const claim = async () => {
    if (!wallet.authenticated || wallet.address === null) {
      setError("Connect and authenticate the separate buyer wallet first.");
      return;
    }
    setStage("claiming");
    setError(null);
    try {
      const response = await fetch(
        `/api/commerce-validation/${encodeURIComponent(sessionId)}/claim`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ token: handoffToken }),
        },
      );
      const payload = (await response.json()) as {
        data?: {
          transactionSubmitted?: boolean;
          session?: { agreementId?: string | null };
        };
        error?: string | { message?: string };
      };
      if (!response.ok || payload.data === undefined) {
        const message =
          typeof payload.error === "string"
            ? payload.error
            : payload.error?.message;
        throw new Error(message ?? "Validation handoff could not be claimed");
      }
      if (payload.data.transactionSubmitted !== false)
        throw new Error("Validation claim returned unsafe transaction state");
      if (typeof payload.data.session?.agreementId !== "string")
        throw new Error("Validation agreement was not prepared");
      setAgreementId(payload.data.session.agreementId);
      setStage("claimed");
    } catch (caught) {
      setStage("idle");
      setError(caught instanceof Error ? caught.message : "Claim failed");
    }
  };

  return (
    <div className="authorization-action">
      {stage === "claimed" ? (
        <div className="readiness-warning complete">
          <strong>Buyer wallet bound to this validation.</strong>
          <span>
            The exact offer-bound mandate and draft agreement are ready. No
            transaction was submitted.
          </span>
          {agreementId === null ? null : (
            <Link
              className="primary-button"
              href={`/commerce/agreements/${encodeURIComponent(agreementId)}`}
            >
              Review validation agreement
            </Link>
          )}
        </div>
      ) : (
        <button
          className="primary-button"
          type="button"
          disabled={stage === "claiming"}
          onClick={() => void claim()}
        >
          {stage === "claiming"
            ? "Binding buyer wallet…"
            : "Use this wallet for validation"}
        </button>
      )}
      {error === null ? null : <span role="alert">{error}</span>}
    </div>
  );
}
