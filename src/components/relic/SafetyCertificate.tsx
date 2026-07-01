"use client";

import { useState } from "react";
import { Copy } from "lucide-react";
import type { ReviewResult } from "@/lib/relic/types";

export function SafetyCertificate({ review }: { review: ReviewResult }) {
  const [copied, setCopied] = useState(false);
  const certificate = review.certificate;

  async function copyReceipt() {
    await navigator.clipboard.writeText(certificate.receiptHash);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  return (
    <section className="border-y border-line bg-raised px-6 py-8">
      <div className="border-y border-line py-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-moss">Relic Safety Certificate</div>
        <h2 className="mt-3 text-4xl font-semibold tracking-tight">Cryptographic review receipt</h2>
      </div>
      <dl className="mt-8 grid gap-x-10 gap-y-5 md:grid-cols-2">
        <CertItem label="Review ID" value={certificate.reviewId} mono />
        <CertItem label="System" value={certificate.systemName} />
        <CertItem label="Change request" value={certificate.requestedChange} />
        <CertItem label="Decision" value={certificate.finalDecision} />
        <CertItem label="Risk level" value={certificate.riskLevel} />
        <CertItem label="Impacted components" value={certificate.impactedComponentCount} />
        <CertItem label="Critical paths" value={review.impactAnalysis.criticalPathCount} />
        <CertItem label="Failed regression tests" value={certificate.failedTestCount} />
        <CertItem label="Affected accounts" value={certificate.affectedAccountCount.toLocaleString("en-US")} />
        <CertItem label="Required human sign-off" value={certificate.requiredHumanSignOffs.join(", ")} />
        <CertItem label="Generated timestamp" value={certificate.generatedTimestamp} mono />
        <CertItem label="Evidence coverage summary" value={`${certificate.evidenceReferences.length} evidence references covered`} />
      </dl>
      <div className="mt-8 border border-line bg-canvas p-4">
        <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">SHA-256 hash</div>
        <div className="break-all font-mono text-sm">{certificate.receiptHash}</div>
      </div>
      <div className="mt-5 flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
        <p className="text-sm text-muted">This receipt represents the review evidence generated in the current simulation.</p>
        <button onClick={copyReceipt} type="button" className="focus-ring inline-flex items-center gap-2 bg-ink px-4 py-3 text-sm font-semibold text-canvas">
          <Copy size={15} aria-hidden="true" />
          {copied ? "Receipt copied" : "Copy receipt"}
        </button>
      </div>
    </section>
  );
}

function CertItem({ label, value, mono }: { label: string; value: React.ReactNode; mono?: boolean }) {
  return (
    <div className="border-t border-line pt-3">
      <dt className="text-[11px] uppercase tracking-[0.16em] text-muted">{label}</dt>
      <dd className={`mt-2 text-sm ${mono ? "font-mono" : ""}`}>{value}</dd>
    </div>
  );
}
