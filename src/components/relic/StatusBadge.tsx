import { CheckCircle2, CircleDashed, OctagonAlert } from "lucide-react";
import { cn } from "@/lib/relic/utils";
import type { AgentStatus, ReviewDecision, TestStatus } from "@/lib/relic/types";

type StatusBadgeProps = {
  status: AgentStatus | ReviewDecision | TestStatus | "Reviewing" | "Simulation";
};

export function StatusBadge({ status }: StatusBadgeProps) {
  const isBad = status === "BLOCKED" || status === "failed" || status === "blocked";
  const isGood = status === "APPROVED" || status === "passed" || status === "completed";
  const Icon = isBad ? OctagonAlert : isGood ? CheckCircle2 : CircleDashed;

  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 border px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em]",
        isBad && "border-blocked text-blocked",
        isGood && "border-approved text-approved",
        !isBad && !isGood && "border-line text-muted",
      )}
    >
      <Icon size={13} aria-hidden="true" />
      {status}
    </span>
  );
}
