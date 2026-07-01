"use client";

import { motion, useReducedMotion } from "framer-motion";
import { AgentTimelineItem } from "./AgentTimelineItem";
import type { AgentRun } from "@/lib/relic/types";

export function AgentTimeline({ agents }: { agents: AgentRun[] }) {
  const reduceMotion = useReducedMotion();

  return (
    <section>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-moss">Agent timeline</div>
      <ol>
        {agents.map((agent, index) => (
          <motion.div
            key={agent.id}
            initial={reduceMotion ? false : { opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
          >
            <AgentTimelineItem agent={agent} index={index} />
          </motion.div>
        ))}
      </ol>
    </section>
  );
}
