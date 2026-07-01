import type { ImpactAnalysis } from "@/lib/relic/types";

export function ImpactSummary({ analysis }: { analysis: ImpactAnalysis }) {
  return (
    <section className="border border-line bg-raised p-5">
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-moss">Impact summary</div>
      <p className="mt-4 text-sm leading-6 text-muted">{analysis.summary}</p>
      <div className="mt-5 space-y-3 text-sm">
        {analysis.impactedComponents.slice(0, 8).map((item) => (
          <div key={item.component.id} className="flex items-center justify-between gap-4 border-t border-line pt-3">
            <span>{item.component.name}</span>
            <span className="text-xs uppercase tracking-[0.14em] text-muted">{item.severity}</span>
          </div>
        ))}
      </div>
    </section>
  );
}
