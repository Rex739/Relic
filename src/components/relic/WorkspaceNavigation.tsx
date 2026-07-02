import { Archive, FileSearch, Settings, Waypoints } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { motion, useReducedMotion } from "framer-motion";
import { cn } from "@/lib/relic/utils";

export type WorkspaceNavItem = {
  label: string;
  icon: LucideIcon;
  active: boolean;
};

export const workspaceNavItems: WorkspaceNavItem[] = [
  { label: "Reviews", icon: FileSearch, active: true },
  { label: "Systems", icon: Waypoints, active: false },
  { label: "Evidence", icon: Archive, active: false },
  { label: "Settings", icon: Settings, active: false },
];

type WorkspaceNavigationProps = {
  collapsed?: boolean;
  onNavigate?: () => void;
};

export function WorkspaceNavigation({ collapsed = false, onNavigate }: WorkspaceNavigationProps) {
  const reduceMotion = useReducedMotion();

  return (
    <nav className="grid gap-1" aria-label="Workspace navigation">
      {workspaceNavItems.map((item) => (
        <button
          key={item.label}
          className={cn(
            "group focus-ring relative flex h-11 items-center border border-transparent text-left text-sm text-muted transition-colors",
            collapsed ? "justify-center px-0" : "gap-3 px-3",
            item.active && "border-line bg-canvas text-ink",
            !item.active && "hover:border-line hover:text-ink",
          )}
          type="button"
          aria-label={collapsed ? item.label : undefined}
          aria-current={item.active ? "page" : undefined}
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
        </button>
      ))}
    </nav>
  );
}
