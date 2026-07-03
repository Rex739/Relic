"use client";

import { createContext, useContext } from "react";

type WorkspaceContextValue = {
  sidebarExpanded: boolean;
  setSidebarExpanded: (expanded: boolean) => void;
};

const WorkspaceContext = createContext<WorkspaceContextValue | undefined>(undefined);

export function WorkspaceProvider({ children, value }: { children: React.ReactNode; value: WorkspaceContextValue }) {
  return <WorkspaceContext.Provider value={value}>{children}</WorkspaceContext.Provider>;
}

export function useWorkspace() {
  const context = useContext(WorkspaceContext);
  if (!context) {
    throw new Error("useWorkspace must be used within WorkspaceProvider.");
  }

  return context;
}
