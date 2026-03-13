import { createContext, useContext } from "react";
import type { Workspace } from "../workspace-store";

interface WorkspaceContextValue {
  workspace: Workspace;
  isActive: boolean;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export const WorkspaceProvider = WorkspaceContext.Provider;

export function useActiveWorkspace() {
  const ctx = useContext(WorkspaceContext);
  return ctx?.workspace ?? null;
}

export function useIsWorkspaceActive() {
  const ctx = useContext(WorkspaceContext);
  return ctx?.isActive ?? false;
}
