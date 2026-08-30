"use client";

import type {
  MarketplaceReviewRole,
  MarketplaceReviewSentiment,
} from "@relic/domain";
import { useEffect, useState } from "react";

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
  const [dismissed, setDismissed] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  if (!checked || dismissed || (!eligible && !submitted)) return null;
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
    <section className="review-prompt">
      <span className="overline">Verified review</span>
      <h2>
        {reviewerRole === "BUYER"
          ? "How was your experience with this agent?"
          : "How was your experience with this buyer?"}
      </h2>
      <p>
        This review will be linked to the completed job. No wallet signature is
        required.
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
        Write a review (optional)
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
          onClick={() => setDismissed(true)}
        >
          Not now
        </button>
      </div>
      {error === null ? null : <p className="review-error">{error}</p>}
    </section>
  );
}
