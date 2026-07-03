"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/relic/utils";
import type { EvidenceReference, EvidenceSeverity, ReviewResult } from "@/lib/relic/types";

const filters: Array<"all" | EvidenceSeverity> = ["all", "critical", "warning", "informational"];

export function EvidencePanel({ review }: { review: ReviewResult }) {
  const [filter, setFilter] = useState<"all" | EvidenceSeverity>("all");
  const componentNames = useMemo(
    () => new Map(review.components.map((component) => [component.id, component.name])),
    [review.components],
  );
  const evidence = filter === "all" ? review.evidence : review.evidence.filter((item) => item.severity === filter);

  return (
    <section>
      <div className="mb-6 flex flex-wrap gap-2">
        {filters.map((item) => (
          <button
            key={item}
            type="button"
            onClick={() => setFilter(item)}
            className={cn(
              "focus-ring border-b px-1 py-2 text-sm capitalize text-muted",
              filter === item ? "border-ink text-ink" : "border-transparent hover:border-line",
            )}
          >
            {item}
          </button>
        ))}
      </div>
      <div className="border-y border-line">
        {evidence.map((item, index) => (
          <EvidenceRow key={item.id} item={item} index={index} componentName={componentNames.get(item.relatedComponentId) ?? item.relatedComponentId} />
        ))}
      </div>
    </section>
  );
}

function EvidenceRow({ item, index, componentName }: { item: EvidenceReference; index: number; componentName: string }) {
  return (
    <article className="grid gap-5 border-b border-line py-6 last:border-b-0 lg:grid-cols-[80px_1fr_220px]">
      <div className="font-mono text-sm text-muted">{String(index + 1).padStart(2, "0")}</div>
      <div>
        <div className="font-mono text-xs text-muted">{item.sourceReference}</div>
        <h3 className="mt-2 text-2xl font-semibold tracking-tight">{item.title}</h3>
        <p className="mt-3 text-sm leading-6 text-muted">{item.proves}</p>
        <blockquote className="mt-4 border-l border-line pl-4 font-mono text-sm text-ink">
          &quot;{item.excerpt}&quot;
        </blockquote>
      </div>
      <dl className="space-y-3 text-sm">
        <div>
          <dt className="text-muted">Component</dt>
          <dd className="mt-1">{componentName}</dd>
        </div>
        <div>
          <dt className="text-muted">Severity</dt>
          <dd className={cn("mt-1 capitalize", item.severity === "critical" && "text-blocked")}>{item.severity}</dd>
        </div>
        <div>
          <dt className="text-muted">Review role</dt>
          <dd className="mt-1">{item.relatedAgent}</dd>
        </div>
      </dl>
    </article>
  );
}
