"use client";

import { useState } from "react";

export function CommerceAuthorization({
  agreementId,
}: {
  agreementId: string;
}) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const authorize = async () => {
    if (window.ethereum === undefined) {
      setError("Connect an EVM wallet first.");
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/commerce/agreements/${agreementId}/authorization-challenge`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ actionHash: null }),
        },
      );
      const challenge = (await response.json()) as {
        challengeId?: string;
        typedData?: Record<string, unknown>;
        authorization?: { principal: string; chainId: number };
        error?: string;
      };
      if (
        !response.ok ||
        challenge.challengeId === undefined ||
        challenge.typedData === undefined ||
        challenge.authorization === undefined
      )
        throw new Error(challenge.error ?? "Authorization challenge failed");
      const currentChain = Number.parseInt(
        (await window.ethereum.request({ method: "eth_chainId" })) as string,
        16,
      );
      if (currentChain !== challenge.authorization.chainId)
        throw new Error(
          "Switch the wallet to the agreement network before signing",
        );
      const signature = (await window.ethereum.request({
        method: "eth_signTypedData_v4",
        params: [
          challenge.authorization.principal,
          JSON.stringify(challenge.typedData),
        ],
      })) as string;
      const verify = await fetch(
        `/api/commerce/agreements/${agreementId}/authorization`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            challengeId: challenge.challengeId,
            signature,
          }),
        },
      );
      const verified = (await verify.json()) as {
        artifactId?: string;
        error?: string;
      };
      if (!verify.ok || verified.artifactId === undefined)
        throw new Error(
          verified.error ?? "Authorization signature was rejected",
        );
      window.location.reload();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Authorization failed",
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="authorization-action">
      <button type="button" onClick={() => void authorize()} disabled={busy}>
        {busy ? "Check wallet…" : "Authorize agreement"}
      </button>
      <p>
        This EIP-712 signature authorizes only the displayed agreement, mandate
        version, terms hash, token, amount, network, nonce, and expiry. It does
        not submit a blockchain transaction.
      </p>
      {error === null ? null : <span role="alert">{error}</span>}
    </div>
  );
}
