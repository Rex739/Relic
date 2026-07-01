"use client";

import { useEffect, useState } from "react";
import { DependencyGraph } from "./DependencyGraph";
import { EvidencePanel } from "./EvidencePanel";
import { LoadingState } from "./LoadingState";
import { ReviewHeader } from "./ReviewHeader";
import { ReviewOverview } from "./ReviewOverview";
import { SafetyCertificate } from "./SafetyCertificate";
import { cn } from "@/lib/relic/utils";
import type { ReviewResult } from "@/lib/relic/types";

const tabs = ["Overview", "Impact Map", "Evidence", "Certificate"] as const;
type Tab = (typeof tabs)[number];

export function ReviewTabs() {
  const [review, setReview] = useState<ReviewResult | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [activeTab, setActiveTab] = useState<Tab>("Overview");
  const [visibleAgents, setVisibleAgents] = useState(0);

  useEffect(() => {
    async function runReview() {
      try {
        const response = await fetch("/api/review/run", { method: "POST" });
        if (!response.ok) {
          throw new Error("Review run failed.");
        }
        const payload = (await response.json()) as ReviewResult;
        setVisibleAgents(0);
        setReview(payload);
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Unexpected review error.");
      }
    }

    void runReview();
  }, []);

  useEffect(() => {
    if (!review) {
      return;
    }

    const timers = review.agents.map((_, index) =>
      window.setTimeout(() => setVisibleAgents(index + 1), 650 * (index + 1)),
    );

    return () => timers.forEach(window.clearTimeout);
  }, [review]);

  if (error) {
    return (
      <div className="p-10">
        <div className="border border-blocked bg-raised p-6 text-blocked" role="alert">{error}</div>
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

  const complete = visibleAgents >= review.agents.length;

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
                "focus-ring border-b-2 px-1 py-4 text-sm text-muted",
                activeTab === tab ? "border-ink text-ink" : "border-transparent hover:border-line",
              )}
            >
              {tab}
            </button>
          ))}
        </nav>
      </div>
      <div className="p-5 lg:p-10">
        {activeTab === "Overview" ? <ReviewOverview review={review} visibleAgents={visibleAgents} /> : null}
        {activeTab === "Impact Map" ? <DependencyGraph review={review} /> : null}
        {activeTab === "Evidence" ? <EvidencePanel review={review} /> : null}
        {activeTab === "Certificate" ? <SafetyCertificate review={review} /> : null}
      </div>
    </>
  );
}
