"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Menu, X } from "lucide-react";
import { AnimatePresence, motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/relic/utils";

type MobileNavigationProps = {
  className?: string;
};

const navigationItems = [
  { label: "Platform", href: "#platform" },
  { label: "Use cases", href: "#use-cases" },
  { label: "How it works", href: "#method" },
  { label: "View sample review", href: "/review/meridian-billing" },
  { label: "Open workspace", href: "/review/new" },
];

export function MobileNavigation({ className }: MobileNavigationProps) {
  const [open, setOpen] = useState(false);
  const reduceMotion = useReducedMotion();
  const panelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOpen(false);
      }
    }

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open]);

  useEffect(() => {
    if (open) {
      panelRef.current?.querySelector<HTMLAnchorElement>("a")?.focus();
    }
  }, [open]);

  return (
    <div className={cn("relative lg:hidden", className)}>
      <button
        type="button"
        className="focus-ring inline-flex h-10 w-10 items-center justify-center border border-line text-ink"
        aria-label={open ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        {open ? <X size={18} aria-hidden="true" /> : <Menu size={18} aria-hidden="true" />}
      </button>

      <AnimatePresence>
        {open ? (
          <>
            <motion.button
              type="button"
              className="fixed inset-0 z-40 bg-ink/10"
              aria-label="Close navigation menu"
              onClick={() => setOpen(false)}
              initial={reduceMotion ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0 }}
              transition={{ duration: reduceMotion ? 0 : 0.16 }}
            />
            <motion.div
              ref={panelRef}
              className="absolute right-0 top-12 z-50 w-[min(82vw,320px)] border border-line bg-raised p-2 shadow-sm"
              initial={reduceMotion ? false : { opacity: 0, y: -6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={reduceMotion ? { opacity: 0 } : { opacity: 0, y: -4 }}
              transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.16, 1, 0.3, 1] }}
            >
              <nav className="grid" aria-label="Mobile primary navigation">
                {navigationItems.map((item) => (
                  <Link
                    key={item.href}
                    href={item.href}
                    className="focus-ring border-b border-line px-3 py-3 text-sm text-muted last:border-b-0 hover:text-ink"
                    onClick={() => setOpen(false)}
                  >
                    {item.label}
                  </Link>
                ))}
              </nav>
            </motion.div>
          </>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
