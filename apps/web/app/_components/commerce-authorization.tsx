"use client";

import { useState } from "react";

import { useRelicWallet } from "./relic-wallet-provider";
import { switchWalletChain, walletTypedDataPayload } from "./wallet-provider";

export function CommerceAuthorization({
  agreementId,
  continuationHref,
  actionHash = null,
}: {
  agreementId: string;
  continuationHref: string;
  actionHash?: string | null;
}) {
  const wallet = useRelicWallet();
  const [stage, setStage] = useState<
    "idle" | "preparing" | "wallet" | "verifying"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const busy = stage !== "idle";

  const authorize = async () => {
    if (!wallet.authenticated || wallet.address === null) {
      setError("Connect and authenticate a wallet through Privy first.");
      return;
    }
    setStage("preparing");
    setError(null);
    try {
      const response = await fetch(
        `/api/commerce/agreements/${agreementId}/authorization-challenge`,
        {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ actionHash }),
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
      setStage("wallet");
      const provider = await wallet.getProvider();
      await switchWalletChain(provider, challenge.authorization.chainId);
      const accounts = (await provider.request({
        method: "eth_accounts",
      })) as string[];
      if (
        accounts[0]?.toLowerCase() !==
        challenge.authorization.principal.toLowerCase()
      )
        throw new Error(
          "The active wallet account does not match the authenticated buyer",
        );
      const signature = (await provider.request({
        method: "eth_signTypedData_v4",
        params: [
          challenge.authorization.principal,
          JSON.stringify(walletTypedDataPayload(challenge.typedData)),
        ],
      })) as string;
      setStage("verifying");
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
      if (actionHash === null) {
        window.location.assign(continuationHref);
      } else {
        const destination = new URL(continuationHref, window.location.origin);
        destination.searchParams.set(
          "exactAuthorizationId",
          verified.artifactId,
        );
        window.location.assign(destination.toString());
      }
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "Authorization failed",
      );
    } finally {
      setStage("idle");
    }
  };

  return (
    <div className="authorization-action">
      <button
        type="button"
        onClick={() => void authorize()}
        disabled={busy}
        aria-busy={busy}
      >
        {stage === "preparing"
          ? "Preparing secure request…"
          : stage === "wallet"
            ? "Waiting for wallet signature…"
            : stage === "verifying"
              ? "Verifying signature…"
              : actionHash === null
                ? "Authorize agreement"
                : "Approve this exact action"}
      </button>
      {busy ? (
        <span
          className="authorization-progress"
          role="status"
          aria-live="polite"
        >
          {stage === "wallet"
            ? "Confirm the typed-data request in your wallet."
            : stage === "verifying"
              ? "Relic is recovering the signer and saving the authorization."
              : "Relic is binding a one-time nonce to this request."}
        </span>
      ) : null}
      <p>
        This EIP-712 signature authorizes only the displayed agreement, mandate
        version, terms hash, token, amount, network, nonce, expiry
        {actionHash === null ? "." : ", and exact canonical action hash."} It
        does not submit a blockchain transaction.
      </p>
      {error === null ? null : <span role="alert">{error}</span>}
    </div>
  );
}
