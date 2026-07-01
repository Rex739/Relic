import { CheckCircle2, CircleDashed, OctagonAlert } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import type { AgentRun } from "@/lib/relic/types";

export function AgentTimelineItem({ agent, index }: { agent: AgentRun; index: number }) {
  const Icon = agent.status === "blocked" ? OctagonAlert : agent.status === "completed" ? CheckCircle2 : CircleDashed;

  return (
    <li className="grid gap-4 border-t border-line py-5 md:grid-cols-[72px_1fr]">
      <div className="flex items-start gap-3">
        <span className="font-mono text-sm text-muted">{String(index + 1).padStart(2, "0")}</span>
        <Icon className={agent.status === "blocked" ? "text-blocked" : "text-moss"} size={18} aria-hidden="true" />
      </div>
      <div>
        <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted">{agent.role}</div>
            <h3 className="mt-1 text-xl font-semibold tracking-tight">{agent.title}</h3>
          </div>
          <div className="flex items-center gap-3">
            <span className="font-mono text-xs text-muted">{agent.timestamp}</span>
            <StatusBadge status={agent.status} />
          </div>
        </div>
        <p className="mt-3 max-w-3xl text-sm leading-6 text-muted">{agent.summary}</p>
        <div className="mt-4 grid gap-2 text-sm">
          {agent.keyFindings.map((finding) => (
            <div key={finding} className="border-l border-line pl-3">{finding}</div>
          ))}
        </div>
        <div className="mt-4 font-mono text-xs text-muted">{agent.evidenceReferences.length} evidence references</div>
      </div>
    </li>
  );
}
