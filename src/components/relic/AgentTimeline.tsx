"use client";

import { motion } from "framer-motion";
import { AgentTimelineItem } from "./AgentTimelineItem";
import type { AgentRun } from "@/lib/relic/types";

export function AgentTimeline({ agents }: { agents: AgentRun[] }) {
  return (
    <section>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-moss">Agent timeline</div>
      <ol>
        {agents.map((agent, index) => (
          <motion.div
            key={agent.id}
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.35 }}
          >
            <AgentTimelineItem agent={agent} index={index} />
          </motion.div>
        ))}
      </ol>
    </section>
  );
}
