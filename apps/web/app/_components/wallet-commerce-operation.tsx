"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { LoaderCircle } from "lucide-react";

import {
  isTransactionHash,
  quoteHasSafeHeadroom,
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
type NextOperation = {
  operationId: string;
  operationType: OperationType;
  operationState: "AWAITING_SIGNATURE";
};

const hasRecordedTransaction = (message: string | null | undefined) =>
  message?.toLowerCase().includes("transaction hash is already recorded") ??
  false;

export function WalletCommerceOperation({
  agreementId,
  operationId,
  operationType,
  operationState,
  autoStart = true,
  onNextOperation,
  onComplete,
}: {
  agreementId: string;
  operationId: string;
  operationType: OperationType;
  operationState: OperationState;
  /** Begin the next required wallet step as soon as checkout reaches it. */
  autoStart?: boolean;
  /** Called when on-chain finality makes the following checkout step ready. */
  onNextOperation?: (operation: NextOperation) => void;
  /** Called once the final checkout operation has reached durable finality. */
  onComplete?: () => void;
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
  const autoStartAttempted = useRef(false);
  const completionNotified = useRef(false);
  useEffect(() => {
    setStage(
      walletOperationNeedsReconciliation(operationState)
        ? "confirming"
        : "idle",
    );
    setError(null);
    setTransactionHash(null);
    setPrepared(null);
    autoStartAttempted.current = false;
    completionNotified.current = false;
  }, [operationId, operationState]);
  useEffect(() => {
    if (stage !== "confirming") return;
    router.refresh();
    const timer = window.setInterval(() => router.refresh(), 2_500);
    return () => window.clearInterval(timer);
  }, [router, stage]);

  useEffect(() => {
    if (
      stage !== "confirming" ||
      (onNextOperation === undefined && onComplete === undefined)
    )
      return;
    let cancelled = false;
    const next = async () => {
      try {
        const response = await fetch(`/api/commerce/agreements/${agreementId}`, {
          cache: "no-store",
        });
        const agreement = (await response.json()) as {
          operations?: Array<Record<string, unknown>>;
        };
        if (!response.ok || cancelled || agreement.operations === undefined) return;
        const nextOperation = agreement.operations
          .toReversed()
          .find(
            (candidate) =>
              candidate.id !== operationId &&
              candidate.state === "AWAITING_SIGNATURE" &&
              typeof candidate.id === "string" &&
              ["APPROVE_TOKEN", "CREATE_JOB", "REGISTER_JOB", "SET_BUDGET", "FUND"].includes(
                String(candidate.operationType),
              ),
          );
        if (nextOperation !== undefined && !cancelled && onNextOperation !== undefined) {
          onNextOperation({
            operationId: String(nextOperation.id),
            operationType: nextOperation.operationType as OperationType,
            operationState: "AWAITING_SIGNATURE",
          });
          return;
        }
        const currentOperation = agreement.operations.find(
          (candidate) => candidate.id === operationId,
        );
        if (
          currentOperation?.state === "FINALIZED" &&
          !cancelled &&
          !completionNotified.current
        ) {
          completionNotified.current = true;
          onComplete?.();
        }
      } catch {
        // The normal refresh loop continues while the indexer reaches finality.
      }
    };
    void next();
    const timer = window.setInterval(() => void next(), 2_500);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
    };
  }, [agreementId, onComplete, onNextOperation, operationId, stage]);

  // A browser reload or a development hot update can resume the UI before it
  // receives the POST response that recorded a wallet transaction. Treat the
  // server's durable hash as authoritative and continue reconciliation rather
  // than leaving the buyer on a duplicate-submission error.
  useEffect(() => {
    if (!hasRecordedTransaction(error)) return;
    setError(null);
    setStage("confirming");
    router.refresh();
  }, [error, router]);
  const busy = stage !== "idle";

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
      if (!recorded.ok && hasRecordedTransaction(result.error)) {
        setStage("confirming");
        router.refresh();
        return;
      }
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

  const label = "Confirm in wallet";

  useEffect(() => {
    if (
      !autoStart ||
      autoStartAttempted.current ||
      operationState !== "AWAITING_SIGNATURE" ||
      !wallet.ready ||
      !wallet.authenticated ||
      wallet.address === null ||
      stage !== "idle"
    )
      return;
    autoStartAttempted.current = true;
    void submit();
  }, [
    autoStart,
    operationId,
    operationState,
    stage,
    submit,
    wallet.address,
    wallet.authenticated,
    wallet.ready,
  ]);

  const amountLabel =
    operationType === "APPROVE_TOKEN"
      ? "Approval amount"
      : operationType === "FUND"
        ? "Payment amount"
        : "Service amount";

  return (
    <div className="authorization-action wallet-commerce-operation">
      {prepared !== null &&
      (operationType === "APPROVE_TOKEN" ||
        operationType === "SET_BUDGET" ||
        operationType === "FUND") ? (
        <dl className="wallet-operation-summary">
          <div>
            <dt>{amountLabel}</dt>
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
      {prepared === null ? null : (
        <p>
          <strong>{prepared.presentation.title}</strong>
          <br />
          {prepared.presentation.description}
        </p>
      )}
      <button
        type="button"
        onClick={() => void submit()}
        disabled={busy}
        aria-busy={busy}
      >
        {busy ? <LoaderCircle className="button-loader" aria-hidden="true" /> : null}
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
          ? "Review the confirmation in your wallet."
          : stage === "submitted"
            ? "Confirmation received. Recording your order…"
            : stage === "confirming"
              ? "Confirmation received. Finalizing your order…"
              : operationType === "APPROVE_TOKEN"
                ? "The exact payment amount will be shown in your wallet before anything moves."
                : operationType === "REGISTER_JOB"
                  ? "This confirms the service can run under your approved request."
                  : operationType === "SET_BUDGET"
                    ? "This confirms the service budget."
                    : operationType === "FUND"
                      ? "This confirms the payment and starts the service."
                      : "This confirms your service request. No funds move in this step."}
      </span>
      {transactionHash === null ? null : (
        <small>Transaction: {transactionHash}</small>
      )}
      {error === null ? null : <span role="alert">{error}</span>}
    </div>
  );
}
