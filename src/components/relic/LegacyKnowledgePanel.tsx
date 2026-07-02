import { cn } from "@/lib/relic/utils";
import type { InstitutionalKnowledgeRecord, KnowledgeStatus } from "@/lib/relic/types";

const statusStyles: Record<KnowledgeStatus, string> = {
  VERIFIED: "border-approved text-approved",
  CONFIRMED: "border-approved text-approved",
  "POLICY-CONTROLLED": "border-muted text-muted",
};

export function LegacyKnowledgePanel({ records }: { records: InstitutionalKnowledgeRecord[] }) {
  return (
    <section className="border border-line bg-raised p-5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-moss">LEGACY KNOWLEDGE</div>
      <p className="mt-3 text-sm leading-6 text-muted">
        Business rules recovered from code, test evidence, and historical system context.
      </p>
      <div className="mt-5 border-y border-line">
        {records.map((record) => (
          <article key={record.id} className="border-b border-line py-5 last:border-b-0">
            <div className="flex items-start justify-between gap-3">
              <h3 className="text-sm font-semibold leading-5">{record.title}</h3>
              <span
                className={cn(
                  "shrink-0 border px-2 py-1 text-[9px] font-semibold uppercase tracking-[0.14em]",
                  statusStyles[record.status],
                )}
              >
                {record.status}
              </span>
            </div>
            <p className="mt-3 text-sm leading-6 text-muted">{record.description}</p>
            <dl className="mt-4 space-y-2 text-xs">
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Source</dt>
                <dd className="text-right font-mono">{record.sourceReference}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Verification</dt>
                <dd className="text-right">{record.verification}</dd>
              </div>
              <div className="flex justify-between gap-4">
                <dt className="text-muted">Confidence</dt>
                <dd className="text-right">{record.confidence}</dd>
              </div>
            </dl>
            <div className="mt-4 flex flex-wrap gap-1.5">
              {record.relatedComponentIds.map((componentId) => (
                <span key={componentId} className="border border-line px-1.5 py-1 font-mono text-[10px] text-muted">
                  {componentId}
                </span>
              ))}
            </div>
          </article>
        ))}
      </div>
    </section>
  );
}
