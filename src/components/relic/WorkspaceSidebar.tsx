"use client";

import Link from "next/link";
import { motion, useReducedMotion } from "framer-motion";
import { BrandLogo } from "./BrandLogo";
import { BrandMark } from "./BrandMark";
import { SidebarToggle } from "./SidebarToggle";
import { WorkspaceNavigation } from "./WorkspaceNavigation";
import { cn } from "@/lib/relic/utils";

type WorkspaceSidebarProps = {
  expanded: boolean;
  onToggle: () => void;
};

export function WorkspaceSidebar({ expanded, onToggle }: WorkspaceSidebarProps) {
  const reduceMotion = useReducedMotion();

  return (
    <motion.aside
      className="hidden border-r border-line bg-raised lg:sticky lg:top-0 lg:block lg:h-[100dvh] lg:self-start lg:overflow-y-auto lg:overscroll-contain"
      initial={false}
      animate={{ width: expanded ? 260 : 76 }}
      transition={{ duration: reduceMotion ? 0 : 0.22, ease: [0.16, 1, 0.3, 1] }}
    >
      <div className={cn("flex min-h-full flex-col", expanded ? "p-6" : "items-center px-3 py-6")}>
        <div className={cn("flex w-full items-start", expanded ? "justify-between gap-4" : "flex-col items-center gap-3")}>
          <Link
            href="/"
            className="focus-ring inline-flex shrink-0 items-center"
            aria-label="Go to Relic home"
          >
            {expanded ? <BrandLogo variant="compact" theme="light" /> : <BrandMark theme="light" size={38} />}
          </Link>
          <SidebarToggle expanded={expanded} onToggle={onToggle} />
        </div>

        <div className={expanded ? "mt-12" : "mt-14 w-full"}>
          <WorkspaceNavigation collapsed={!expanded} />
        </div>

        <div className={cn("mt-10 border-t border-line pt-5 lg:mt-auto", expanded ? "w-full" : "w-full text-center")}>
          {expanded ? (
            <>
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-moss">Meridian Grid</div>
              <div className="mt-2 text-sm font-medium">Billing Core</div>
              <div className="mt-1 text-xs text-muted">Simulation workspace</div>
            </>
          ) : (
            <div className="relative">
              <div
                className="mx-auto flex h-9 w-9 items-center justify-center border border-line font-mono text-[10px] font-semibold text-moss"
                aria-label="Meridian Grid Billing Core simulation workspace"
              >
                MG
              </div>
            </div>
          )}
        </div>
      </div>
    </motion.aside>
  );
}
