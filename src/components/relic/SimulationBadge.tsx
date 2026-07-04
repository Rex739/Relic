import { Circle } from "lucide-react";

export function SimulationBadge() {
  return (
    <span
      className="inline-flex cursor-default items-center gap-1.5 border border-line px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted"
      aria-label="Demo scenario — deterministic Meridian Grid review data"
      title="Demo scenario — deterministic Meridian Grid review data"
    >
      <Circle size={8} className="fill-moss text-moss" aria-hidden="true" />
      Demo scenario
    </span>
  );
}
