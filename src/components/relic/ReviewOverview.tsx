"use client";

import { motion, useReducedMotion } from "framer-motion";
import { MetricCard } from "./MetricCard";
import { RemediationCard } from "./RemediationCard";
import { AgentTimeline } from "./AgentTimeline";
import { TestResults } from "./TestResults";
import { ImpactSummary } from "./ImpactSummary";
import type { ReviewResult } from "@/lib/relic/types";

export function ReviewOverview({ review, visibleAgents }: { review: ReviewResult; visibleAgents: number }) {
  const reduceMotion = useReducedMotion();
  const complete = visibleAgents >= review.agents.length;
  const failedTestCount = review.regressionResults.filter((result) => result.status === "failed").length;
  const remediation = review.regressionResults.find((result) => result.remediation)?.remediation ?? "";

  return (
    <div className="grid gap-8 xl:grid-cols-[1fr_360px]">
      <div className="space-y-8">
        <motion.section
          className="border-l-2 border-blocked bg-raised px-6 py-7"
          initial={reduceMotion ? false : { opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
        >
          <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted">
            {complete ? "Review outcome" : "Review in progress"}
          </div>
          <h2 className="mt-4 text-4xl font-semibold tracking-tight text-blocked">
            {complete ? review.decision : "Review in progress"}
          </h2>
          {complete ? (
            <>
              <p className="mt-3 text-xl font-medium">{review.decisionReason}</p>
              <p className="mt-1 text-lg text-muted">
                {review.affectedAccountCount.toLocaleString("en-US")} historical commercial accounts could be affected
              </p>
              <p className="mt-6 max-w-3xl border-t border-line pt-5 leading-7 text-muted">
                The proposed surcharge is evaluated before the legacy volume-discount reconciliation branch is resolved.
                For eligible commercial accounts, both paths emit a charge entry to the ledger, creating duplicate invoice
                exposure.
              </p>
            </>
          ) : (
            <p className="mt-5 max-w-2xl leading-7 text-muted">Agent stages are being revealed from the review result returned by the API.</p>
          )}
        </motion.section>

        <section className="grid gap-5 border-y border-line py-6 md:grid-cols-4">
          <MetricCard value={review.impactAnalysis.impactedComponents.length} label="Impacted components" />
          <MetricCard value={review.impactAnalysis.criticalPathCount} label="Critical paths" />
          <MetricCard value={failedTestCount} label="Failed regression test" />
          <MetricCard value={review.affectedAccountCount.toLocaleString("en-US")} label="Affected accounts" />
        </section>

        <AgentTimeline agents={review.agents.slice(0, visibleAgents)} />
        <TestResults results={review.regressionResults} />
      </div>

      <motion.aside
        className="space-y-6"
        initial={reduceMotion ? false : { opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: reduceMotion ? 0 : 0.08, duration: 0.38, ease: [0.16, 1, 0.3, 1] }}
      >
        <ImpactSummary analysis={review.impactAnalysis} />
        <section className="border border-line bg-raised p-5">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-moss">Review metadata</div>
          <dl className="mt-5 space-y-4 text-sm">
            <div className="flex justify-between gap-4 border-b border-line pb-3">
              <dt className="text-muted">Blast radius</dt>
              <dd className="font-semibold">{review.impactAnalysis.blastRadiusScore}/100</dd>
            </div>
            <div className="flex justify-between gap-4 border-b border-line pb-3">
              <dt className="text-muted">Evidence references</dt>
              <dd className="font-semibold">{review.evidence.length}</dd>
            </div>
            <div className="flex justify-between gap-4">
              <dt className="text-muted">Required sign-off</dt>
              <dd className="text-right font-semibold">{review.requiredHumanSignOffs.join(", ")}</dd>
            </div>
          </dl>
        </section>
        <RemediationCard remediation={remediation} />
      </motion.aside>
    </div>
  );
}
