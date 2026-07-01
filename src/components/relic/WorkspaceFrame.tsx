import { Archive, FileSearch, Settings, Waypoints } from "lucide-react";
import { Brand } from "./Brand";
import { cn } from "@/lib/relic/utils";

const navItems = [
  { label: "Reviews", icon: FileSearch, active: true },
  { label: "Systems", icon: Waypoints, active: false },
  { label: "Evidence", icon: Archive, active: false },
  { label: "Settings", icon: Settings, active: false },
];

export function WorkspaceFrame({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <div className="grid min-h-screen lg:grid-cols-[260px_1fr]">
        <aside className="border-b border-line bg-raised lg:border-b-0 lg:border-r">
          <div className="flex h-full flex-col p-6">
            <Brand />
            <nav className="mt-12 grid gap-1" aria-label="Workspace navigation">
              {navItems.map((item) => (
                <button
                  key={item.label}
                  className={cn(
                    "focus-ring flex items-center gap-3 border border-transparent px-3 py-3 text-left text-sm text-muted transition",
                    item.active && "border-line bg-canvas text-ink",
                    !item.active && "hover:border-line hover:text-ink",
                  )}
                  type="button"
                >
                  <item.icon size={16} aria-hidden="true" />
                  {item.label}
                </button>
              ))}
            </nav>
            <div className="mt-10 border-t border-line pt-5 lg:mt-auto">
              <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-moss">Meridian Grid</div>
              <div className="mt-2 text-sm font-medium">Billing Core</div>
              <div className="mt-1 text-xs text-muted">Simulation workspace</div>
            </div>
          </div>
        </aside>
        <main>{children}</main>
      </div>
    </div>
  );
}
