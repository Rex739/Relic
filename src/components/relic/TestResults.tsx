"use client";

import { useState } from "react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { ChevronDown } from "lucide-react";
import { StatusBadge } from "./StatusBadge";
import { cn } from "@/lib/relic/utils";
import type { RegressionTestResult } from "@/lib/relic/types";

export function TestResults({ results }: { results: RegressionTestResult[] }) {
  const [openId, setOpenId] = useState(results.find((result) => result.status === "failed")?.id);
  const reduceMotion = useReducedMotion();

  return (
    <section>
      <div className="mb-4 text-[11px] font-semibold uppercase tracking-[0.18em] text-moss">Regression tests</div>
      <div className="border-y border-line">
        {results.map((result) => {
          const open = openId === result.id;

          return (
            <div key={result.id} className="border-b border-line last:border-b-0">
              <button
                type="button"
                onClick={() => setOpenId(open ? undefined : result.id)}
                className="focus-ring grid w-full gap-4 py-4 text-left md:grid-cols-[1fr_140px_120px_40px]"
                aria-expanded={open}
              >
                <div>
                  <div className="font-medium">{result.name}</div>
                  <div className="mt-1 text-sm text-muted">{result.summary}</div>
                </div>
                <StatusBadge status={result.status} />
                <div className={cn("text-sm uppercase tracking-[0.14em] text-muted", result.severity === "critical" && "text-blocked")}>
                  {result.severity ?? "normal"}
                  {result.affectedAccounts ? ` / ${result.affectedAccounts}` : ""}
                </div>
                <ChevronDown className={cn("transition", open && "rotate-180")} size={18} aria-hidden="true" />
              </button>
              <AnimatePresence initial={false}>
                {open ? (
                  <motion.div
                    initial={reduceMotion ? false : { height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={reduceMotion ? { opacity: 0 } : { height: 0, opacity: 0 }}
                    transition={{ duration: 0.24, ease: [0.16, 1, 0.3, 1] }}
                    className="overflow-hidden"
                  >
                    <div className="pb-5 pl-0 text-sm leading-6 text-muted md:pr-48">
                      <p>{result.details}</p>
                      <div className="mt-3 font-mono text-xs">{result.sourceReferences.join(" · ")}</div>
                    </div>
                  </motion.div>
                ) : null}
              </AnimatePresence>
            </div>
          );
        })}
      </div>
    </section>
  );
}
