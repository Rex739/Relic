"use client";

import type {
  MarketplaceReviewRole,
  MarketplaceReviewSentiment,
} from "@relic/domain";
import { useEffect, useRef, useState } from "react";

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
}: {
  activationId: string;
  reviewerRole?: MarketplaceReviewRole;
  tagOptions: Record<MarketplaceReviewSentiment, readonly string[]>;
}) {
  const [eligible, setEligible] = useState(false);
  const [checked, setChecked] = useState(false);
  const [sentiment, setSentiment] = useState<MarketplaceReviewSentiment | null>(
    null,
  );
  const [tags, setTags] = useState<string[]>([]);
  const [message, setMessage] = useState("");
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
        <p>Your review is linked to this completed marketplace job.</p>
      </section>
    );

  const availableTags = sentiment === null ? [] : tagOptions[sentiment];
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
          This review will be linked to the completed job. No wallet signature
          is required.
        </p>
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
          This review will be linked to the completed job. No wallet signature
          is required.
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
            disabled={pending || sentiment === null}
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
