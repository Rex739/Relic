"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Archive, FileSearch, Settings, Waypoints } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { useEffect, useState } from "react";
import { cn } from "@/lib/relic/utils";

export type WorkspaceNavItem = {
  label: string;
  href: string;
  icon: LucideIcon;
  isActive: (pathname: string, query: URLSearchParams) => boolean;
};

export const workspaceNavItems: WorkspaceNavItem[] = [
  {
    label: "Reviews",
    href: "/review/new",
    icon: FileSearch,
    isActive: (pathname, query) => pathname.startsWith("/review") && query.get("tab") !== "evidence",
  },
  {
    label: "Systems",
    href: "/systems",
    icon: Waypoints,
    isActive: (pathname) => pathname === "/systems",
  },
  {
    label: "Evidence",
    href: "/review/meridian-billing?tab=evidence",
    icon: Archive,
    isActive: (pathname, query) => pathname === "/review/meridian-billing" && query.get("tab") === "evidence",
  },
  {
    label: "Settings",
    href: "/settings",
    icon: Settings,
    isActive: (pathname) => pathname === "/settings",
  },
];

type WorkspaceNavigationProps = {
  collapsed?: boolean;
  onNavigate?: () => void;
};

export function WorkspaceNavigation({ collapsed = false, onNavigate }: WorkspaceNavigationProps) {
  const reduceMotion = useReducedMotion();
  const pathname = usePathname();
  const [query, setQuery] = useState(() => new URLSearchParams());

  useEffect(() => {
    function syncQuery() {
      setQuery(new URLSearchParams(window.location.search));
    }

    syncQuery();
    window.addEventListener("popstate", syncQuery);
    window.addEventListener("relic:workspace-nav", syncQuery);
    return () => {
      window.removeEventListener("popstate", syncQuery);
      window.removeEventListener("relic:workspace-nav", syncQuery);
    };
  }, [pathname]);

  return (
    <nav className="grid gap-1" aria-label="Workspace navigation">
      {workspaceNavItems.map((item) => {
        const active = item.isActive(pathname, query);

        return (
          <Link
            key={item.label}
            href={item.href}
            className={cn(
              "group focus-ring relative flex h-11 items-center border border-transparent text-left text-sm text-muted transition-colors",
              collapsed ? "justify-center px-0" : "gap-3 px-3",
              active && "border-line bg-canvas text-ink",
              !active && "hover:border-line hover:text-ink",
            )}
            aria-label={collapsed ? item.label : undefined}
            aria-current={active ? "page" : undefined}
            onClick={onNavigate}
          >
            <item.icon size={16} aria-hidden="true" />
            {collapsed ? (
              <span
                className="pointer-events-none absolute left-[calc(100%+8px)] top-1/2 z-20 hidden -translate-y-1/2 whitespace-nowrap border border-line bg-raised px-2 py-1 text-xs text-ink shadow-sm group-hover:block group-focus-visible:block"
                role="tooltip"
              >
                {item.label}
              </span>
            ) : (
              <motion.span
                initial={false}
                animate={{ opacity: 1 }}
                transition={{ duration: reduceMotion ? 0 : 0.16 }}
              >
                {item.label}
              </motion.span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
