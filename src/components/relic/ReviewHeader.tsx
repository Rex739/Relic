import { StatusBadge } from "./StatusBadge";
import { formatDateTime } from "@/lib/relic/utils";
import type { ReviewResult } from "@/lib/relic/types";

export function ReviewHeader({ review, visibleComplete }: { review: ReviewResult; visibleComplete: boolean }) {
  return (
    <header className="border-b border-line px-5 py-8 lg:px-10">
      <div className="text-sm text-muted">Reviews / Meridian Grid / Billing Policy Change</div>
      <div className="mt-6 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div>
          <h1 className="max-w-4xl text-4xl font-semibold tracking-tight md:text-6xl">Billing Policy Change</h1>
          <p className="mt-3 text-lg text-muted">Meridian Grid · Billing Core</p>
        </div>
        <StatusBadge status={visibleComplete ? review.decision : "Reviewing"} />
      </div>
      <dl className="mt-8 grid gap-4 border-t border-line pt-5 text-sm md:grid-cols-4">
        <div>
          <dt className="text-[11px] uppercase tracking-[0.16em] text-muted">Review ID</dt>
          <dd className="mt-1 font-mono text-xs">{review.reviewId}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-[0.16em] text-muted">Started</dt>
          <dd className="mt-1">{formatDateTime(review.startedAt)}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-[0.16em] text-muted">Environment</dt>
          <dd className="mt-1">{review.environment}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-[0.16em] text-muted">Risk sensitivity</dt>
          <dd className="mt-1">{review.changeRequest.riskSensitivity}</dd>
        </div>
      </dl>
    </header>
  );
}
