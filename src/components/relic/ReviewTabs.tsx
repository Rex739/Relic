"use client";

import { useCallback, useEffect, useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { DependencyGraph } from "./DependencyGraph";
import { EvidencePanel } from "./EvidencePanel";
import { KaspaCommitmentPanel } from "./KaspaCommitmentPanel";
import { LoadingState } from "./LoadingState";
import { ReviewHeader } from "./ReviewHeader";
import { ReviewOverview } from "./ReviewOverview";
import { SafetyCertificate } from "./SafetyCertificate";
import { cn } from "@/lib/relic/utils";
import {
  getInitialVisibleAgentCount,
  isReviewComplete,
  nextVisibleAgentCount,
  REVIEW_REQUEST_TIMEOUT_MS,
  REVIEW_STAGE_DELAY_MS,
} from "@/lib/relic/reviewStaging";
import type { ReviewResult } from "@/lib/relic/types";

const tabs = ["Overview", "Impact Map", "Evidence", "Commitment", "Certificate"] as const;
type Tab = (typeof tabs)[number];

async function requestReview(signal: AbortSignal): Promise<ReviewResult> {
  const response = await fetch("/api/review/run", { method: "POST", signal });
  if (!response.ok) {
    throw new Error("Review run failed.");
  }
  return (await response.json()) as ReviewResult;
}

function getReviewErrorMessage(caught: unknown): string {
  if (caught instanceof DOMException && caught.name === "AbortError") {
    return "Review request timed out.";
  }
  return caught instanceof Error ? caught.message : "Unexpected review error.";
}

export function ReviewTabs() {
  const [review, setReview] = useState<ReviewResult | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const [visibleAgents, setVisibleAgents] = useState(0);
  const reduceMotion = useReducedMotion();

  const runReview = useCallback(async () => {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REVIEW_REQUEST_TIMEOUT_MS);

    setError(undefined);
    setReview(undefined);
    setVisibleAgents(0);

    try {
      const payload = await requestReview(controller.signal);
      setVisibleAgents(getInitialVisibleAgentCount(payload.agents.length, false));
      setReview(payload);
    } catch (caught) {
      setError(getReviewErrorMessage(caught));
    } finally {
      window.clearTimeout(timeout);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), REVIEW_REQUEST_TIMEOUT_MS);

    async function loadReview() {
      try {
        const payload = await requestReview(controller.signal);
        if (!cancelled) {
          setVisibleAgents(getInitialVisibleAgentCount(payload.agents.length, false));
          setReview(payload);
        }
      } catch (caught) {
        if (!cancelled) {
          setError(getReviewErrorMessage(caught));
        }
      } finally {
        window.clearTimeout(timeout);
      }
    }

    void loadReview();

    return () => {
      cancelled = true;
      controller.abort();
      window.clearTimeout(timeout);
    };
  }, []);

  useEffect(() => {
    if (!review) {
      return;
    }

    if (reduceMotion === true) {
      return;
    }

    const timers = review.agents.map((_, index) =>
      window.setTimeout(
        () => setVisibleAgents((current) => nextVisibleAgentCount(current, index + 1)),
        REVIEW_STAGE_DELAY_MS * (index + 1),
      ),
    );
    const completionTimer = window.setTimeout(
      () => setVisibleAgents(review.agents.length),
      REVIEW_STAGE_DELAY_MS * (review.agents.length + 1),
    );

    return () => {
      timers.forEach(window.clearTimeout);
      window.clearTimeout(completionTimer);
    };
  }, [reduceMotion, review]);

  if (error) {
    return (
      <div>
        <div className="border-b border-line px-5 py-8 lg:px-10">
          <h1 className="text-5xl font-semibold tracking-tight">Billing Policy Change</h1>
          <p className="mt-3 text-muted">Meridian Grid · Billing Core</p>
        </div>
        <div className="p-5 lg:p-10">
          <div className="border border-blocked bg-raised p-6" role="alert">
            <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-blocked">Review unavailable</div>
            <p className="mt-4 max-w-xl text-sm leading-6 text-muted">
              Relic could not complete this review. {error} No release recommendation has been issued.
            </p>
            <button
              type="button"
              onClick={() => void runReview()}
              className="focus-ring mt-5 border border-ink px-4 py-3 text-sm font-semibold text-ink transition-colors hover:bg-ink hover:text-canvas"
            >
              Retry review
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!review) {
    return (
      <div>
        <div className="border-b border-line px-5 py-8 lg:px-10">
          <h1 className="text-5xl font-semibold tracking-tight">Billing Policy Change</h1>
          <p className="mt-3 text-muted">Meridian Grid · Billing Core</p>
        </div>
        <div className="p-5 lg:p-10">
          <LoadingState />
        </div>
      </div>
    );
  }

  const displayedVisibleAgents = Math.max(
    visibleAgents,
    getInitialVisibleAgentCount(review.agents.length, reduceMotion === true),
  );
  const complete = isReviewComplete(displayedVisibleAgents, review.agents.length);

  return (
    <>
      <ReviewHeader review={review} visibleComplete={complete} />
      <div className="border-b border-line px-5 lg:px-10">
        <nav className="flex gap-6 overflow-x-auto" aria-label="Review sections">
          {tabs.map((tab) => (
            <button
              key={tab}
              type="button"
              onClick={() => setActiveTab(tab)}
              className={cn(
                "focus-ring relative px-1 py-4 text-sm text-muted",
                activeTab === tab ? "text-ink" : "hover:text-ink",
              )}
            >
              {tab}
              {activeTab === tab ? (
                <motion.span
                  layoutId="review-tab-underline"
                  className="absolute inset-x-0 bottom-0 h-0.5 bg-ink"
                  transition={{ duration: reduceMotion ? 0 : 0.24, ease: [0.16, 1, 0.3, 1] }}
                />
              ) : null}
            </button>
          ))}
        </nav>
      </div>
      <div className="p-5 lg:p-10">
        <AnimatePresence mode="wait" initial={false}>
          <motion.div
            key={activeTab}
            initial={reduceMotion ? false : { opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
            transition={{ duration: 0.23, ease: [0.16, 1, 0.3, 1] }}
          >
            {activeTab === "Overview" ? <ReviewOverview review={review} visibleAgents={displayedVisibleAgents} /> : null}
            {activeTab === "Impact Map" ? <DependencyGraph review={review} /> : null}
            {activeTab === "Evidence" ? <EvidencePanel review={review} /> : null}
            {activeTab === "Commitment" ? <KaspaCommitmentPanel /> : null}
            {activeTab === "Certificate" ? <SafetyCertificate review={review} /> : null}
          </motion.div>
        </AnimatePresence>
      </div>
    </>
  );
}
