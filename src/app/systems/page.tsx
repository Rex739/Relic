import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CommandBar } from "@/components/relic/CommandBar";
import { WorkspaceFrame } from "@/components/relic/WorkspaceFrame";

const systemFacts = [
  ["Components scanned", "10"],
  ["Policy rules in scope", "3"],
  ["Historical account samples", "2,500"],
  ["Estimated review duration", "Under 1 minute"],
];

export default function SystemsPage() {
  return (
    <WorkspaceFrame>
      <CommandBar breadcrumb="Systems" />
      <div className="px-5 py-8 lg:px-10">
        <div className="max-w-3xl">
          <h1 className="text-4xl font-semibold tracking-tight md:text-5xl">Systems</h1>
          <p className="mt-3 text-lg text-muted">Systems currently available for change-impact review.</p>
        </div>

        <section className="mt-10 border border-line bg-raised">
          <div className="grid gap-0 lg:grid-cols-[1fr_360px]">
            <div className="p-5 md:p-7">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-moss">
                Simulation workspace
              </div>
              <h2 className="mt-4 text-3xl font-semibold tracking-tight">Meridian Grid</h2>
              <div className="mt-1 text-base font-medium text-muted">Billing Core</div>
              <p className="mt-6 max-w-2xl leading-7 text-muted">
                Meridian Grid Billing Core manages commercial billing policy, invoice generation, ledger writing,
                reporting, and audit records.
              </p>
              <Link
                href="/review/meridian-billing"
                className="focus-ring mt-8 inline-flex items-center gap-2 bg-ink px-5 py-3 text-sm font-semibold text-canvas"
              >
                Open sample review <ArrowRight size={16} aria-hidden="true" />
              </Link>
            </div>

            <dl className="border-t border-line p-5 md:p-7 lg:border-l lg:border-t-0">
              {systemFacts.map(([label, value]) => (
                <div key={label} className="flex items-start justify-between gap-6 border-b border-line py-4 first:pt-0 last:border-b-0 last:pb-0">
                  <dt className="text-sm text-muted">{label}</dt>
                  <dd className="text-right font-semibold text-ink">{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </section>
      </div>
    </WorkspaceFrame>
  );
}
