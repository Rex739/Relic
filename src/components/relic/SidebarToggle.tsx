import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/relic/utils";

type SidebarToggleProps = {
  expanded: boolean;
  onToggle: () => void;
  className?: string;
};

export function SidebarToggle({ expanded, onToggle, className }: SidebarToggleProps) {
  return (
    <button
      type="button"
      className={cn(
        "focus-ring inline-flex h-9 w-9 items-center justify-center border border-line text-muted transition-colors hover:border-ink hover:text-ink",
        className,
      )}
      aria-label={expanded ? "Collapse workspace navigation" : "Expand workspace navigation"}
      onClick={onToggle}
    >
      {expanded ? <PanelLeftClose size={16} aria-hidden="true" /> : <PanelLeftOpen size={16} aria-hidden="true" />}
    </button>
  );
}
