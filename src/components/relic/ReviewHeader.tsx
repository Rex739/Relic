"use client";

import { motion, useReducedMotion } from "framer-motion";
import { StatusBadge } from "./StatusBadge";
import { formatDateTime } from "@/lib/relic/utils";
import type { ReviewResult } from "@/lib/relic/types";

export function ReviewHeader({ review, visibleComplete }: { review: ReviewResult; visibleComplete: boolean }) {
  const reduceMotion = useReducedMotion();

  return (
    <header className="min-w-0 border-b border-line px-5 py-8 lg:px-10">
      <div className="break-words text-sm text-muted">Reviews / Meridian Grid / Billing Policy Change</div>
      <div className="mt-6 flex min-w-0 flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
        <div className="min-w-0">
          <h1 className="max-w-4xl break-words text-4xl font-semibold tracking-tight md:text-6xl">Billing Policy Change</h1>
          <p className="mt-3 text-lg text-muted">Meridian Grid · Billing Core</p>
        </div>
        <StatusBadge status={visibleComplete ? review.decision : "Reviewing"} />
      </div>
      <motion.dl
        className="mt-8 grid min-w-0 gap-4 border-t border-line pt-5 text-sm md:grid-cols-4"
        initial={reduceMotion ? false : { opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.32, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="min-w-0">
          <dt className="text-[11px] uppercase tracking-[0.16em] text-muted">Review ID</dt>
          <dd className="mt-1 break-words font-mono text-xs">{review.reviewId}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] uppercase tracking-[0.16em] text-muted">Started</dt>
          <dd className="mt-1">{formatDateTime(review.startedAt)}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] uppercase tracking-[0.16em] text-muted">Environment</dt>
          <dd className="mt-1">{review.environment}</dd>
        </div>
        <div className="min-w-0">
          <dt className="text-[11px] uppercase tracking-[0.16em] text-muted">Risk sensitivity</dt>
          <dd className="mt-1">{review.changeRequest.riskSensitivity}</dd>
        </div>
      </motion.dl>
    </header>
  );
}
