"use client";

import { useMemo, useState } from "react";
import {
  createBlockedMeridianCommitment,
  meridianGridBlockedEvidence,
  transitionReleaseCommitment,
  type CommitmentStatus,
  type ReleaseCommitment,
} from "@/lib/relic/kaspa/releaseCommitment";
import { cn } from "@/lib/relic/utils";

const timeline = [
  "Review blocked",
  "Finance acknowledgement",
  "Billing Policy acknowledgement",
  "Remediation required",
  "Separate clean review required",
] as const;

export function KaspaCommitmentPanel() {
  const [commitment, setCommitment] = useState<ReleaseCommitment>(() => createBlockedMeridianCommitment());
  const [message, setMessage] = useState("Local simulation resets on refresh.");

  const timelineActiveIndex = useMemo(() => {
    if (commitment.commitmentStatus === "REMEDIATION_REQUIRED") {
      return 4;
    }

    if (commitment.commitmentStatus === "FINANCE_ACKNOWLEDGED") {
      return 1;
    }

    return 0;
  }, [commitment.commitmentStatus]);

  function applyFinanceAcknowledgement() {
    const result = transitionReleaseCommitment(commitment, {
      type: "FINANCE_ACKNOWLEDGE",
      actorRole: "FINANCE_SYSTEMS_OWNER",
      occurredAt: new Date().toISOString(),
    });

    if (result.ok) {
      setCommitment(result.commitment);
      setMessage("Finance acknowledgement recorded in local simulation.");
      return;
    }

    setMessage(result.error.message);
  }

  function applyBillingAcknowledgement() {
    const result = transitionReleaseCommitment(commitment, {
      type: "BILLING_ACKNOWLEDGE",
      actorRole: "BILLING_POLICY_LEAD",
      occurredAt: new Date().toISOString(),
    });

    if (result.ok) {
      setCommitment(result.commitment);
      setMessage("Billing Policy acknowledgement recorded. Remediation remains required.");
      return;
    }

    setMessage(result.error.message);
  }

  const financeComplete = Boolean(commitment.financeAcknowledgedAt);
  const billingComplete = Boolean(commitment.billingAcknowledgedAt);
  const billingDisabled = !financeComplete || billingComplete;

  return (
    <section className="border-y border-line bg-raised px-5 py-7 sm:px-6 lg:px-8">
      <div className="border-y border-line py-6">
        <div className="text-[11px] font-semibold uppercase tracking-[0.2em] text-moss">Kaspa Testnet 12</div>
        <div className="mt-3 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <h2 className="text-3xl font-semibold tracking-tight sm:text-4xl">Kaspa Release Commitment</h2>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted">
              A programmable release-control record for high-risk system changes.
            </p>
          </div>
          <StatusBadge status={commitment.commitmentStatus} />
        </div>
      </div>

      <div className="mt-7 grid gap-5 xl:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
        <div className="space-y-5">
          <div className="border border-line bg-canvas p-5">
            <div className="grid gap-4 md:grid-cols-2">
              <InfoItem label="Status" value={formatStatus(commitment.commitmentStatus)} tone="blocked" />
              <InfoItem label="Source verdict" value={commitment.reviewVerdict} tone="blocked" />
            </div>
            <p className="mt-5 border-l-2 border-blocked pl-4 text-sm font-medium leading-6 text-blocked">
              This blocked commitment cannot be released. A separate clean review is required.
            </p>
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <div className="border border-line bg-canvas p-5">
              <h3 className="text-sm font-semibold">Truthful covenant state</h3>
              <dl className="mt-5 space-y-3">
                <CompactItem label="Network" value="Kaspa Testnet 12" />
                <CompactItem label="Covenant" value="Compiled locally" />
                <CompactItem label="Verification" value="Static verification completed" />
                <CompactItem label="Deployment" value="Not deployed" />
              </dl>
            </div>

            <div className="border border-line bg-canvas p-5">
              <h3 className="text-sm font-semibold">Required acknowledgements</h3>
              <div className="mt-5 space-y-3">
                <AcknowledgementRow label="Finance Systems Owner" complete={financeComplete} />
                <AcknowledgementRow label="Billing Policy Lead" complete={billingComplete} />
              </div>
            </div>
          </div>

          <div className="border border-line bg-canvas p-5">
            <h3 className="text-sm font-semibold">Review evidence</h3>
            <dl className="mt-5 grid gap-4 sm:grid-cols-2">
              <InfoItem label="Review ID" value={meridianGridBlockedEvidence.reviewId} mono />
              <InfoItem label="Impacted components" value={meridianGridBlockedEvidence.impactedComponentCount} />
              <InfoItem label="Critical paths" value={meridianGridBlockedEvidence.criticalPathCount} />
              <InfoItem label="Failed regression tests" value={meridianGridBlockedEvidence.failedRegressionTestCount} />
              <InfoItem
                label="Potentially affected accounts"
                value={meridianGridBlockedEvidence.affectedAccountCount.toLocaleString("en-US")}
              />
              <InfoItem label="Evidence digest" value={commitment.evidenceDigest} mono wide />
            </dl>
          </div>
        </div>

        <div className="space-y-5">
          <div className="border border-line bg-canvas p-5">
            <h3 className="text-sm font-semibold">Commitment timeline</h3>
            <ol className="mt-5 space-y-4">
              {timeline.map((item, index) => {
                const completed = index <= timelineActiveIndex;
                const current = index === timelineActiveIndex;
                return (
                  <li key={item} className="grid grid-cols-[24px_1fr] gap-3">
                    <span
                      className={cn(
                        "mt-0.5 flex h-6 w-6 items-center justify-center border text-[10px] font-semibold",
                        completed ? "border-approved text-approved" : "border-line text-muted",
                        current && commitment.commitmentStatus !== "REMEDIATION_REQUIRED" ? "border-blocked text-blocked" : "",
                      )}
                    >
                      {index + 1}
                    </span>
                    <span className={cn("pt-1 text-sm", completed ? "text-ink" : "text-muted")}>{item}</span>
                  </li>
                );
              })}
            </ol>
          </div>

          <div className="border border-line bg-canvas p-5">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">
              Demo control - local state simulation
            </div>
            <div className="mt-5 flex flex-col gap-3">
              <button
                type="button"
                onClick={applyFinanceAcknowledgement}
                disabled={financeComplete}
                className="focus-ring border border-ink px-4 py-3 text-left text-sm font-semibold text-ink transition-colors hover:bg-ink hover:text-canvas disabled:cursor-not-allowed disabled:border-line disabled:text-muted disabled:hover:bg-transparent"
              >
                Acknowledge as Finance Systems Owner
              </button>
              <button
                type="button"
                onClick={applyBillingAcknowledgement}
                disabled={billingDisabled}
                className="focus-ring border border-ink px-4 py-3 text-left text-sm font-semibold text-ink transition-colors hover:bg-ink hover:text-canvas disabled:cursor-not-allowed disabled:border-line disabled:text-muted disabled:hover:bg-transparent"
              >
                Acknowledge as Billing Policy Lead
              </button>
            </div>
            <p className="mt-4 text-sm leading-6 text-muted">{message}</p>
            <p className="mt-4 border-t border-line pt-4 text-xs leading-5 text-muted">
              No wallet connection, transaction id, explorer link, deployment confirmation, or mainnet claim is produced by this local simulation.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}

function StatusBadge({ status }: { status: CommitmentStatus }) {
  const remediation = status === "REMEDIATION_REQUIRED";

  return (
    <div
      className={cn(
        "w-fit border px-3 py-2 font-mono text-xs font-semibold uppercase tracking-[0.14em]",
        remediation ? "border-blocked text-blocked" : "border-line text-muted",
      )}
    >
      {formatStatus(status)}
    </div>
  );
}

function InfoItem({
  label,
  value,
  mono,
  tone,
  wide,
}: {
  label: string;
  value: string | number;
  mono?: boolean;
  tone?: "blocked";
  wide?: boolean;
}) {
  return (
    <div className={cn("border-t border-line pt-3", wide ? "sm:col-span-2" : "")}>
      <dt className="text-[11px] uppercase tracking-[0.16em] text-muted">{label}</dt>
      <dd className={cn("mt-2 break-words text-sm", mono ? "font-mono" : "", tone === "blocked" ? "font-semibold text-blocked" : "")}>
        {value}
      </dd>
    </div>
  );
}

function CompactItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-start justify-between gap-4 border-t border-line pt-3">
      <dt className="text-[11px] uppercase tracking-[0.16em] text-muted">{label}</dt>
      <dd className="text-right text-sm font-medium">{value}</dd>
    </div>
  );
}

function AcknowledgementRow({ label, complete }: { label: string; complete: boolean }) {
  return (
    <div className="flex items-center justify-between gap-4 border-t border-line pt-3">
      <span className="text-sm">{label}</span>
      <span className={cn("font-mono text-[11px] uppercase tracking-[0.14em]", complete ? "text-approved" : "text-muted")}>
        {complete ? "Complete" : "Pending"}
      </span>
    </div>
  );
}

function formatStatus(status: CommitmentStatus) {
  return status.replaceAll("_", " ");
}
