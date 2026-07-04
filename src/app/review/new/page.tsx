import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { CommandBar } from "@/components/relic/CommandBar";
import { WorkspaceFrame } from "@/components/relic/WorkspaceFrame";

export default function NewReviewPage() {
  return (
    <WorkspaceFrame>
      <CommandBar breadcrumb="Reviews / New review" />
      <div className="px-5 py-8 lg:px-10">
        <h1 className="text-5xl font-semibold tracking-tight">New safety review</h1>
        <p className="mt-3 max-w-2xl text-lg text-muted">
          Assess the operational impact of a change before it enters a critical system.
        </p>
        <div className="mt-10 grid gap-8 xl:grid-cols-[1fr_360px]">
          <form className="space-y-6">
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">System</span>
              <input className="focus-ring mt-2 w-full border border-line bg-raised px-4 py-3" defaultValue="Meridian Grid · Billing Core" />
            </label>
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Change request</span>
              <textarea
                className="focus-ring mt-2 min-h-36 w-full border border-line bg-raised px-4 py-3 leading-7"
                defaultValue="Apply a 7% regulatory surcharge only to commercial customers with monthly consumption above 10,000 kWh."
              />
            </label>
            <fieldset aria-describedby="review-policy-helper">
              <legend className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Review policy</legend>
              <p id="review-policy-helper" className="mt-2 text-sm leading-6 text-muted">
                Strict — block unresolved billing and ledger risk.
              </p>
              <div className="mt-3 grid gap-2 md:grid-cols-3">
                {["Standard", "Strict", "Critical"].map((item) => (
                  <label key={item} className="flex items-center gap-3 border border-line bg-raised px-4 py-3">
                    <input type="radio" name="risk" defaultChecked={item === "Strict"} />
                    {item}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="block">
              <span className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">Review objective</span>
              <input className="focus-ring mt-2 w-full border border-line bg-raised px-4 py-3" defaultValue="Detect downstream billing, ledger, and reporting regressions." />
            </label>
            <Link href="/review/meridian-billing" className="focus-ring inline-flex items-center gap-2 bg-ink px-5 py-3 text-sm font-semibold text-canvas">
              Run safety review <ArrowRight size={16} aria-hidden="true" />
            </Link>
          </form>

          <aside className="border border-line bg-raised p-6">
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-moss">System profile</div>
            <h2 className="mt-3 text-2xl font-semibold tracking-tight">Meridian Grid / Billing Core</h2>
            <dl className="mt-7 space-y-5">
              {[
                ["Components scanned", "10"],
                ["Policy rules in scope", "3"],
                ["Historical account samples", "2,500"],
                ["Estimated review duration", "Under 1 minute"],
              ].map(([label, value]) => (
                <div key={label} className="flex justify-between border-t border-line pt-4">
                  <dt className="text-sm text-muted">{label}</dt>
                  <dd className="font-semibold">{value}</dd>
                </div>
              ))}
            </dl>
          </aside>
        </div>
      </div>
    </WorkspaceFrame>
  );
}
