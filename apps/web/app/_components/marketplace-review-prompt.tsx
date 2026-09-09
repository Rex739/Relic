"use client";

import type {
  MarketplaceReviewRole,
  MarketplaceReviewSentiment,
} from "@relic/domain";
import { useEffect, useRef, useState } from "react";

type ReceiptPreview = {
  executionId: string;
  status: string;
  chainId: 56 | 97;
  category?: string;
  outcome: Record<string, unknown>;
  evidence: Record<string, unknown>;
  source: string;
  transactionHash: string | null;
  observedAt: string;
};

const questionsFor = (category?: string) => {
  if (category === "health-factor-monitoring")
    return [
      ["timeliness", "Did the alert or response arrive in time?"],
      ["accuracy", "Did the reported health-factor result match what you observed?"],
      ["risk_adherence", "Did the service stay within the authorized risk limits?"],
    ] as const;
  if (category === "grid-trading")
    return [
      ["capital_adherence", "Did the service stay within the capital cap?"],
      ["execution_accuracy", "Did the reported fills and result match the activity?"],
      ["risk_adherence", "Did the service stay within the requested grid and limits?"],
    ] as const;
  if (category === "rebalancing")
    return [
      ["range_result", "Did the position end in the requested range?"],
      ["execution_accuracy", "Did the reported transactions match what happened?"],
      ["risk_adherence", "Did the service stay within the authorized cap and contracts?"],
    ] as const;
  if (category === "yield-optimisation")
    return [
      ["balance_accuracy", "Did the reported balances match the result?"],
      ["execution_accuracy", "Were deposits or withdrawals executed as described?"],
      ["risk_adherence", "Did the service stay within the authorized limits?"],
    ] as const;
  return [] as const;
};

const tagLabel = (tag: string) =>
  tag === "didnt-follow-instructions"
    ? "Didn't follow instructions"
    : tag
        .replaceAll("-", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());

export function MarketplaceReviewPrompt({
  activationId,
  reviewerRole = "BUYER",
  tagOptions,
  category,
  receipt = null,
}: {
  activationId: string;
  reviewerRole?: MarketplaceReviewRole;
  tagOptions: Record<MarketplaceReviewSentiment, readonly string[]>;
  category?: string;
  receipt?: ReceiptPreview | null;
}) {
  const [eligible, setEligible] = useState(false);
  const [checked, setChecked] = useState(false);
  const [sentiment, setSentiment] = useState<MarketplaceReviewSentiment | null>(
    null,
  );
  const [tags, setTags] = useState<string[]>([]);
  const [message, setMessage] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [open, setOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    void fetch(
      `/api/marketplace/reviews/eligibility/${encodeURIComponent(activationId)}?reviewerRole=${reviewerRole}`,
      { cache: "no-store" },
    )
      .then(async (response) => {
        const payload = (await response.json()) as {
          data?: { eligible?: boolean };
        };
        setEligible(response.ok && payload.data?.eligible === true);
      })
      .catch(() => setEligible(false))
      .finally(() => setChecked(true));
  }, [activationId, reviewerRole]);

  useEffect(() => {
    const element = dialog.current;
    if (element === null) return;
    if (open && !element.open) element.showModal();
    if (!open && element.open) element.close();
  }, [open]);

  if (!checked || (!eligible && !submitted)) return null;
  if (submitted)
    return (
      <section className="review-prompt success" aria-live="polite">
        <span className="overline">Verified review</span>
        <h2>Thank you for sharing your experience.</h2>
        <p>Your review is linked to this finished marketplace job and its receipt.</p>
      </section>
    );

  const availableTags = sentiment === null ? [] : tagOptions[sentiment];
  const questions = questionsFor(category);
  const questionsComplete = questions.every(([key]) => answers[key] !== undefined);
  const submit = async () => {
    if (sentiment === null) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/marketplace/reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          activationId,
          reviewerRole,
          sentiment,
          tags,
          answers,
          message: message.trim() || null,
        }),
      });
      const payload = (await response.json()) as {
        error?: string | { message?: string };
      };
      if (!response.ok)
        throw new Error(
          typeof payload.error === "string"
            ? payload.error
            : (payload.error?.message ?? "Review could not be submitted"),
        );
      setOpen(false);
      setSubmitted(true);
      setEligible(false);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Review could not be submitted",
      );
    } finally {
      setPending(false);
    }
  };

  return (
    <section className="review-prompt review-prompt-cta">
      <div>
        <span className="overline">Verified review</span>
        <h2>
          {reviewerRole === "BUYER"
            ? "How did it go?"
            : "How did it go with this buyer?"}
        </h2>
        <p>
          This review will be linked to the finished job and its receipt. No wallet
          signature is required.
        </p>
        {receipt === null ? null : (
          <section
            className="review-receipt"
            aria-label="Verified execution receipt"
          >
            <span className="overline">Verified execution receipt</span>
            <strong>{receipt.status.replaceAll("_", " ")}</strong>
            <p>
              {typeof receipt.outcome.message === "string"
                ? receipt.outcome.message
                : "Relic recorded the execution result for this job."}
            </p>
            <small>
              {receipt.source.replaceAll("_", " ")} ·{" "}
              {new Date(receipt.observedAt).toLocaleString()}
              {receipt.transactionHash === null
                ? ""
                : " · "}
              {receipt.transactionHash === null ? null : (
                <a
                  href={`${receipt.chainId === 97 ? "https://testnet.bscscan.com" : "https://bscscan.com"}/tx/${receipt.transactionHash}`}
                  target="_blank"
                  rel="noreferrer"
                >
                  View transaction ↗
                </a>
              )}
            </small>
          </section>
        )}
        {reviewerRole === "BUYER" && questions.length > 0 ? (
          <fieldset className="review-outcome-questions">
            <legend>How did the verified result hold up?</legend>
            {questions.map(([key, question]) => (
              <label key={key}>
                <span>{question}</span>
                <select
                  value={answers[key] ?? ""}
                  onChange={(event) =>
                    setAnswers((current) => ({
                      ...current,
                      [key]: event.target.value,
                    }))
                  }
                  required
                >
                  <option value="">Choose one</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                  <option value="not_sure">Not sure</option>
                </select>
              </label>
            ))}
          </fieldset>
        ) : null}
      </div>
      <button type="button" onClick={() => setOpen(true)}>
        Leave a verified review
      </button>
      <dialog
        ref={dialog}
        className="review-dialog"
        aria-labelledby="review-dialog-heading"
        onClose={() => setOpen(false)}
      >
        <div className="review-dialog-header">
          <div>
            <span className="overline">Verified review</span>
            <h2 id="review-dialog-heading">
              {reviewerRole === "BUYER"
                ? "How did it go?"
                : "How did it go with this buyer?"}
            </h2>
          </div>
          <button
            type="button"
            className="secondary-button"
            aria-label="Close review"
            onClick={() => setOpen(false)}
          >
            Close
          </button>
        </div>
        <p>
          This review will be linked to the finished job and its receipt. No wallet
          signature is required.
        </p>
        <div
          className="review-sentiment"
          role="group"
          aria-label="Review sentiment"
        >
          {(["GOOD", "BAD"] as const).map((value) => (
            <button
              key={value}
              type="button"
              className={sentiment === value ? "selected" : ""}
              onClick={() => {
                setSentiment(value);
                setTags([]);
              }}
            >
              {value === "GOOD" ? "Good" : "Bad"}
            </button>
          ))}
        </div>
        {sentiment === null ? null : (
          <div className="review-tags">
            {availableTags.map((tag) => (
              <label key={tag}>
                <input
                  type="checkbox"
                  checked={tags.includes(tag)}
                  onChange={() =>
                    setTags((current) =>
                      current.includes(tag)
                        ? current.filter((item) => item !== tag)
                        : [...current, tag],
                    )
                  }
                />
                {tagLabel(tag)}
              </label>
            ))}
          </div>
        )}
        <label className="review-message">
          Add details (optional)
          <textarea
            value={message}
            maxLength={1_000}
            placeholder="Share more about your experience..."
            onChange={(event) => setMessage(event.target.value)}
          />
        </label>
        <div className="review-actions">
          <button
            type="button"
            disabled={pending || sentiment === null || !questionsComplete}
            onClick={submit}
          >
            {pending ? "Submitting review…" : "Submit review"}
          </button>
          <button
            type="button"
            className="secondary-button"
            onClick={() => setOpen(false)}
          >
            Not now
          </button>
        </div>
        {error === null ? null : <p className="review-error">{error}</p>}
      </dialog>
    </section>
  );
}
