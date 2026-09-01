"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

import {
  isTransactionHash,
  quoteHasSafeHeadroom,
  quoteRemainingSeconds,
  walletOperationNeedsReconciliation,
  walletSubmissionError,
} from "../../lib/wallet-commerce";
import { useRelicWallet } from "./relic-wallet-provider";
import { switchWalletChain } from "./wallet-provider";

type OperationType =
  "APPROVE_TOKEN" | "CREATE_JOB" | "REGISTER_JOB" | "SET_BUDGET" | "FUND";
type OperationState =
  "AWAITING_SIGNATURE" | "SUBMITTED" | "PENDING" | "CONFIRMED";
type PreparedWalletTransaction = {
  operationId: string;
  operationType: OperationType;
  chainId: number;
  from: string;
  to: string;
  data: string;
  value: "0x0";
  preparedPayloadHash: string;
  authorizationExpiresAt?: string;
  quoteNegotiatedAt?: string;
  quoteExpiresAt?: string;
  quoteMinimumRemainingSeconds?: number;
  jobExpiresAt?: string;
  presentation: {
    title: string;
    action: string;
    description: string;
    network: string;
    servicePrice: string;
    fundsExpectedToMove: boolean;
    jobId?: string;
    cost?: string;
  };
};

type WalletTransaction = { nonce?: string };

export function WalletCommerceOperation({
  agreementId,
  operationId,
  operationType,
  operationState,
  initialQuoteExpiresAt,
  initialQuoteNegotiatedAt,
  paidValidation = false,
}: {
  agreementId: string;
  operationId: string;
  operationType: OperationType;
  operationState: OperationState;
  initialQuoteExpiresAt?: string;
  initialQuoteNegotiatedAt?: string;
  paidValidation?: boolean;
}) {
  const router = useRouter();
  const wallet = useRelicWallet();
  const [stage, setStage] = useState<
    "idle" | "preparing" | "awaiting_wallet" | "submitted" | "confirming"
  >(walletOperationNeedsReconciliation(operationState) ? "confirming" : "idle");
  const [error, setError] = useState<string | null>(null);
  const [transactionHash, setTransactionHash] = useState<string | null>(null);
  const [prepared, setPrepared] = useState<PreparedWalletTransaction | null>(
    null,
  );
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    setStage(
      walletOperationNeedsReconciliation(operationState)
        ? "confirming"
        : "idle",
    );
    setError(null);
    setTransactionHash(null);
    setPrepared(null);
  }, [operationId, operationState]);
  useEffect(() => {
    if (prepared === null && initialQuoteExpiresAt === undefined) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [initialQuoteExpiresAt, prepared]);
  useEffect(() => {
    if (stage !== "confirming") return;
    router.refresh();
    const timer = window.setInterval(() => router.refresh(), 2_500);
    return () => window.clearInterval(timer);
  }, [router, stage]);
  const busy = stage !== "idle";
  const remaining = (value: string | undefined) =>
    value === undefined ? null : quoteRemainingSeconds(value, now);
  const displayRemaining = (seconds: number | null) =>
    seconds === null
      ? "Unavailable"
      : `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  const quoteExpiresAt = prepared?.quoteExpiresAt ?? initialQuoteExpiresAt;
  const quoteNegotiatedAt =
    prepared?.quoteNegotiatedAt ?? initialQuoteNegotiatedAt;
  const setupStep = paidValidation
    ? operationType === "APPROVE_TOKEN"
      ? 1
      : operationType === "CREATE_JOB"
        ? 2
        : operationType === "REGISTER_JOB"
          ? 3
          : operationType === "SET_BUDGET"
            ? 4
            : 5
    : operationType === "CREATE_JOB"
      ? 1
      : operationType === "REGISTER_JOB"
        ? 2
        : operationType === "SET_BUDGET"
          ? 3
          : 4;
  const setupSteps = paidValidation ? 5 : 4;

  const submit = async () => {
    if (!wallet.authenticated || wallet.address === null) {
      setError("Connect and authenticate your buyer wallet first.");
      return;
    }
    setStage("preparing");
    setError(null);
    let walletReturnedHash = false;
    try {
      const endpoint = `/api/commerce/agreements/${agreementId}/operations/${operationId}/wallet-transaction`;
      const response = await fetch(endpoint, { cache: "no-store" });
      const transaction = (await response.json()) as
        PreparedWalletTransaction | { error?: string };
      if (!response.ok || !("data" in transaction))
        throw new Error(
          "error" in transaction && transaction.error
            ? transaction.error
            : "Relic could not safely prepare this wallet action.",
        );
      if (
        transaction.operationId !== operationId ||
        transaction.operationType !== operationType ||
        transaction.chainId !== 97 ||
        transaction.value !== "0x0" ||
        (transaction.presentation.fundsExpectedToMove &&
          operationType !== "FUND")
      )
        throw new Error("The prepared operation does not match this request.");
      setPrepared(transaction);
      if (
        transaction.quoteExpiresAt !== undefined &&
        transaction.quoteMinimumRemainingSeconds !== undefined &&
        !quoteHasSafeHeadroom(
          transaction.quoteExpiresAt,
          transaction.quoteMinimumRemainingSeconds,
          Date.now(),
        )
      )
        throw new Error(
          "The signed seller quote no longer has enough time for this setup step. Start a fresh commerce attempt.",
        );
      const provider = await wallet.getProvider();
      await switchWalletChain(provider, 97);
      const accounts = (await provider.request({
        method: "eth_accounts",
      })) as string[];
      const signerAddress = accounts[0];
      if (
        signerAddress === undefined ||
        signerAddress.toLowerCase() !== transaction.from.toLowerCase()
      )
        throw new Error("The active wallet is not the authorized buyer.");
      setStage("awaiting_wallet");
      const hash = await provider.request({
        method: "eth_sendTransaction",
        params: [
          {
            from: transaction.from,
            to: transaction.to,
            data: transaction.data,
            value: transaction.value,
          },
        ],
      });
      if (!isTransactionHash(hash))
        throw new Error(
          "Your wallet did not return a transaction hash. Nothing was recorded.",
        );
      walletReturnedHash = true;
      setTransactionHash(hash);
      setStage("submitted");
      let nonce: string | undefined;
      try {
        const walletTransaction = (await provider.request({
          method: "eth_getTransactionByHash",
          params: [hash],
        })) as WalletTransaction | null;
        nonce = walletTransaction?.nonce;
      } catch {
        // Nonce is supplementary evidence; the returned transaction hash is authoritative.
      }
      const recorded = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          transactionHash: hash,
          signerAddress,
          preparedPayloadHash: transaction.preparedPayloadHash,
          ...(nonce === undefined ? {} : { nonce }),
        }),
      });
      const result = (await recorded.json()) as { error?: string };
      if (!recorded.ok)
        throw new Error(
          result.error ??
            "The transaction was sent, but Relic could not record it. Keep the transaction hash shown below.",
        );
      setStage("confirming");
      router.refresh();
    } catch (caught) {
      if (!walletReturnedHash) setStage("idle");
      setError(walletSubmissionError(caught));
    }
  };

  const label =
    operationType === "APPROVE_TOKEN" ||
    operationType === "REGISTER_JOB" ||
    operationType === "SET_BUDGET" ||
    operationType === "FUND"
      ? "Confirm in wallet"
      : "Start 15-minute setup session";

  return (
    <div className="authorization-action wallet-commerce-operation">
      <div
        className="activation-setup-session"
        aria-label="Activation setup session"
      >
        <div>
          <strong>
            Agent setup · step {setupStep} of {setupSteps}
          </strong>
          <span>
            {paidValidation
              ? "Approve payment → Create service → Apply safety → Set budget → Fund escrow"
              : "Create service → Apply safety → Set budget → Start service"}
          </span>
        </div>
        {quoteExpiresAt === undefined ? (
          <small>
            The 15-minute setup window starts only after every readiness check
            passes.
          </small>
        ) : (
          <div
            className="activation-setup-countdown"
            role="timer"
            aria-live="polite"
          >
            <span>Setup time remaining</span>
            <strong>{displayRemaining(remaining(quoteExpiresAt))}</strong>
            {quoteNegotiatedAt === undefined ? null : (
              <small>
                Started {new Date(quoteNegotiatedAt).toLocaleTimeString()}
              </small>
            )}
          </div>
        )}
      </div>
      {prepared !== null &&
      (operationType === "APPROVE_TOKEN" ||
        operationType === "SET_BUDGET" ||
        operationType === "FUND") ? (
        <dl className="wallet-operation-summary">
          <div>
            <dt>Budget</dt>
            <dd>{prepared.presentation.servicePrice}</dd>
          </div>
          <div>
            <dt>Network</dt>
            <dd>BSC Testnet</dd>
          </div>
          <div>
            <dt>Funds moved</dt>
            <dd>
              {prepared.presentation.fundsExpectedToMove
                ? "Escrow deposit"
                : "None"}
            </dd>
          </div>
          <div>
            <dt>Cost</dt>
            <dd>{prepared.presentation.cost ?? "Gas only"}</dd>
          </div>
        </dl>
      ) : null}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy}
        aria-busy={busy}
      >
        {stage === "preparing"
          ? "Preparing safely…"
          : stage === "awaiting_wallet"
            ? "Waiting for wallet confirmation…"
            : stage === "submitted"
              ? "Transaction submitted…"
              : stage === "confirming"
                ? "Confirming on BSC Testnet…"
                : label}
      </button>
      <span role="status" aria-live="polite">
        {stage === "awaiting_wallet"
          ? "Review the BSC Testnet contract call in your wallet. Relic records nothing unless the wallet returns a transaction hash."
          : stage === "submitted"
            ? "Your wallet returned a transaction hash. Relic is recording it now."
            : stage === "confirming"
              ? "Transaction recorded. Relic is reconciling finality and will prepare the next manual wallet step automatically."
              : operationType === "APPROVE_TOKEN"
                ? "This grants the commerce contract an exact-amount token allowance. It does not move tokens."
                : operationType === "REGISTER_JOB"
                  ? paidValidation
                    ? "This applies the approved safety policy. No tokens move in this step."
                    : "This applies the approved safety policy. You pay network gas only; the service remains free and no funds move."
                  : operationType === "SET_BUDGET"
                    ? "This records the exact offer budget. No tokens move in this step."
                    : operationType === "FUND"
                      ? "This deposits the approved offer amount into escrow and starts the job."
                      : "This creates the offer-bound service job. It does not fund or settle anything."}
      </span>
      {transactionHash === null ? null : (
        <small>Transaction: {transactionHash}</small>
      )}
      {error === null ? null : <span role="alert">{error}</span>}
      {prepared === null && quoteExpiresAt === undefined ? null : (
        <>
          {quoteExpiresAt === undefined ? null : (
            <div className="wallet-operation-expiry" role="status">
              <strong>Secure setup window</strong>
              {operationType === "CREATE_JOB" ? (
                <span>
                  Buyer approval:{" "}
                  {displayRemaining(
                    remaining(prepared?.authorizationExpiresAt),
                  )}
                </span>
              ) : null}
              <span>
                Time remaining: {displayRemaining(remaining(quoteExpiresAt))}
              </span>
              {operationType === "CREATE_JOB" ? (
                <span>
                  Job expiry after creation:{" "}
                  {prepared?.jobExpiresAt === undefined
                    ? "Unavailable"
                    : new Date(prepared.jobExpiresAt).toLocaleString()}
                </span>
              ) : null}
              <small>
                Complete all {setupSteps} confirmations before this setup window
                expires. Relic stops safely when too little time remains.
              </small>
            </div>
          )}
          {prepared === null ? null : (
            <details>
              <summary>Technical evidence</summary>
              <dl>
                <div>
                  <dt>Operation</dt>
                  <dd>{prepared.operationType}</dd>
                </div>
                <div>
                  <dt>Network</dt>
                  <dd>{prepared.presentation.network} · chain ID 97</dd>
                </div>
                <div>
                  <dt>Contract</dt>
                  <dd>{prepared.to}</dd>
                </div>
                <div>
                  <dt>Prepared payload hash</dt>
                  <dd>{prepared.preparedPayloadHash}</dd>
                </div>
                <div>
                  <dt>Funds expected to move</dt>
                  <dd>
                    {prepared.presentation.fundsExpectedToMove ? "Yes" : "No"}
                  </dd>
                </div>
              </dl>
            </details>
          )}
        </>
      )}
    </div>
  );
}
