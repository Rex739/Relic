"use client";

import type { MarketplaceReview } from "@relic/domain";
import { MessageCircleOff, ThumbsDown, ThumbsUp } from "lucide-react";
import { useMemo, useState } from "react";

import { productCapabilityLabel, relativeTime } from "../../lib/marketplace";

type ReviewFilter = "ALL" | "GOOD" | "BAD";

export function AgentVerifiedReviews({
  reviews,
  total,
  good,
  bad,
}: {
  reviews: MarketplaceReview[];
  total: number;
  good: number;
  bad: number;
}) {
  const [filter, setFilter] = useState<ReviewFilter>("ALL");
  const writtenReviews = useMemo(
    () =>
      reviews.filter(
        (review) =>
          review.message !== null &&
          (filter === "ALL" || review.sentiment === filter),
      ),
    [filter, reviews],
  );
  const counts = { ALL: total, GOOD: good, BAD: bad } as const;

  if (total === 0)
    return (
      <div className="empty-review-state">
        <MessageCircleOff aria-hidden="true" size={24} />
        <div>
          <b>No verified reviews yet</b>
        </div>
      </div>
    );

  return (
    <div className="marketplace-reviews">
      <span className="review-summary">
        {total} {total === 1 ? "verified review" : "verified reviews"} · {good}{" "}
        good · {bad} bad
      </span>
      <div
        className="review-filter"
        role="group"
        aria-label="Filter verified reviews"
      >
        {(["ALL", "GOOD", "BAD"] as const).map((value) => (
          <button
            key={value}
            type="button"
            className={filter === value ? "selected" : ""}
            onClick={() => setFilter(value)}
          >
            {value === "ALL" ? "All" : value === "GOOD" ? "Good" : "Bad"} (
            {counts[value]})
          </button>
        ))}
      </div>
      {writtenReviews.length === 0 ? (
        <p className="empty-written-review-state">
          No written reviews in this category yet.
        </p>
      ) : (
        <div className="review-list">
          {writtenReviews.map((review) => (
            <article key={review.id}>
              <span className="review-avatar" aria-hidden="true">
                {review.reviewerRole === "BUYER" ? "B" : "A"}
              </span>
              <div className="review-content">
                <div className="review-meta">
                  <b>
                    {review.reviewerRole === "BUYER"
                      ? "Marketplace buyer"
                      : "Marketplace agent"}
                  </b>
                  <span
                    className={`review-public-sentiment ${review.sentiment.toLowerCase()}`}
                  >
                    {review.sentiment === "GOOD" ? "Good" : "Bad"}
                  </span>
                  <time>{relativeTime(review.createdAt)}</time>
                </div>
                {review.tags.length > 0 ? (
                  <div className="review-tags">
                    {review.tags.map((tag) => (
                      <span key={tag}>
                        {review.sentiment === "GOOD" ? (
                          <ThumbsUp aria-hidden="true" size={13} />
                        ) : (
                          <ThumbsDown aria-hidden="true" size={13} />
                        )}
                        {productCapabilityLabel(tag)}
                      </span>
                    ))}
                  </div>
                ) : null}
                <p>{review.message}</p>
                <small>Verified hire</small>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
