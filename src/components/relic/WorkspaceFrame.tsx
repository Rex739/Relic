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
    <div className="min-h-[100dvh] bg-canvas text-ink">
      <div className="grid min-h-[100dvh] lg:grid-cols-[260px_1fr]">
        <header className="border-b border-line bg-raised lg:hidden">
          <div className="flex items-start justify-between gap-4 px-4 py-4">
            <Brand />
            <button
              className="focus-ring border border-line px-3 py-2 text-xs font-semibold uppercase tracking-[0.14em] text-muted"
              type="button"
              aria-label="Workspace navigation"
            >
              Workspace
            </button>
          </div>
          <div className="border-t border-line px-4 py-3">
            <div className="text-[11px] font-semibold uppercase tracking-[0.16em] text-moss">
              Meridian Grid · Billing Core
            </div>
            <div className="mt-1 text-xs text-muted">Simulation workspace</div>
          </div>
          <nav
            className="flex gap-5 overflow-x-auto border-t border-line px-4 text-sm [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
            aria-label="Mobile workspace navigation"
          >
            {navItems.map((item) => (
              <button
                key={item.label}
                className={cn(
                  "focus-ring whitespace-nowrap border-b-2 px-0 py-3 text-muted",
                  item.active ? "border-ink text-ink" : "border-transparent",
                )}
                type="button"
              >
                {item.label}
              </button>
            ))}
          </nav>
        </header>

        <aside className="hidden border-b border-line bg-raised lg:sticky lg:top-0 lg:block lg:h-[100dvh] lg:self-start lg:overflow-y-auto lg:border-b-0 lg:border-r">
          <div className="flex min-h-full flex-col p-6">
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
        <main className="min-w-0">{children}</main>
      </div>
    </div>
  );
}
