"use client";

import { useState } from "react";
import { WorkspaceMobileHeader } from "./WorkspaceMobileHeader";
import { WorkspaceProvider } from "./WorkspaceContext";
import { WorkspaceSidebar } from "./WorkspaceSidebar";

export function WorkspaceFrame({ children }: { children: React.ReactNode }) {
  const [sidebarExpanded, setSidebarExpanded] = useState(true);

  return (
    <WorkspaceProvider value={{ sidebarExpanded, setSidebarExpanded }}>
      <div className="min-h-[100dvh] bg-canvas text-ink">
        <div className="grid min-h-[100dvh] grid-cols-[minmax(0,1fr)] lg:grid-cols-[auto_minmax(0,1fr)]">
          <WorkspaceMobileHeader />
          <WorkspaceSidebar expanded={sidebarExpanded} onToggle={() => setSidebarExpanded((current) => !current)} />
          <main className="min-w-0">{children}</main>
        </div>
      </div>
    </WorkspaceProvider>
  );
}
