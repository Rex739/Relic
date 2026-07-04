"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Menu, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { BrandMark } from "./BrandMark";
import { WorkspaceNavigation } from "./WorkspaceNavigation";

export function WorkspaceMobileHeader() {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const drawerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (open) {
      drawerRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    }
  }, [open]);

  return (
    <header className="min-w-0 border-b border-line bg-raised lg:hidden">
      <div className="flex items-center justify-between gap-4 px-4 py-3">
        <Link href="/" className="focus-ring flex min-w-0 items-center gap-3" aria-label="Go to Relic home">
          <BrandMark theme="light" size={34} />
          <div className="min-w-0">
            <div className="text-xl font-semibold uppercase tracking-[0.18em]">RELIC</div>
            <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Change intelligence</div>
          </div>
        </Link>
        <button
          type="button"
          className="focus-ring inline-flex h-10 w-10 items-center justify-center border border-line text-ink"
          aria-label="Open workspace navigation"
          aria-expanded={open}
          onClick={() => setOpen(true)}
        >
          <Menu size={18} aria-hidden="true" />
        </button>
      </div>
      <div className="border-t border-line px-4 py-3">
        <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-moss">
          Meridian Grid · Billing Core
        </div>
        <div className="mt-1 text-xs text-muted">Simulation workspace</div>
      </div>

      <AnimatePresence>
        {open ? (
          <>
            <motion.button
              type="button"
              className="fixed inset-0 z-40 bg-ink/20"
              aria-label="Close workspace navigation"
              onClick={() => setOpen(false)}
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.16 }}
            />
            <motion.div
              ref={drawerRef}
              className="fixed left-0 top-0 z-50 h-[100dvh] w-[min(82vw,320px)] overflow-y-auto border-r border-line bg-raised p-5 shadow-sm"
              initial={reduceMotion ? false : { x: -18, opacity: 0 }}
              animate={{ x: 0, opacity: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { x: -12, opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.2, ease: [0.16, 1, 0.3, 1] }}
            >
              <div className="flex items-start justify-between gap-4">
                <Link
                  href="/"
                  className="focus-ring flex min-w-0 items-center gap-3"
                  aria-label="Go to Relic home"
                  onClick={() => setOpen(false)}
                >
                  <BrandMark theme="light" size={34} />
                  <div className="min-w-0">
                    <div className="text-xl font-semibold uppercase tracking-[0.18em]">RELIC</div>
                    <div className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted">Workspace</div>
                  </div>
                </Link>
                <button
                  type="button"
                  className="focus-ring inline-flex h-9 w-9 items-center justify-center border border-line text-ink"
                  aria-label="Close workspace navigation"
                  onClick={() => setOpen(false)}
                >
                  <X size={17} aria-hidden="true" />
                </button>
              </div>
              <div className="mt-8">
                <WorkspaceNavigation onNavigate={() => setOpen(false)} />
              </div>
              <div className="mt-10 border-t border-line pt-5">
                <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-moss">Meridian Grid</div>
                <div className="mt-2 text-sm font-medium">Billing Core</div>
                <div className="mt-1 text-xs text-muted">Simulation workspace</div>
              </div>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </header>
  );
}
