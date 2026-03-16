import { useMemo, useEffect, useLayoutEffect } from "react";
import { ProjectBar } from "./components/layout/ProjectBar";
import { StatusBar } from "./components/layout/StatusBar";
import { EmptyState } from "./components/layout/EmptyState";
import { PaneContainer } from "./components/panes/PaneContainer";
import { PanePortalProvider } from "./components/panes/PanePortalContext";
import { DragOverlay } from "./components/panes/DragOverlay";
import { ToastContainer } from "./components/shared/Toast";
import { WorkspaceProvider } from "./contexts/WorkspaceContext";
import { useLayoutStore } from "./store/layout.store";
import { useWorkspaceStore } from "./store/workspace.store";
import { useSettingsStore } from "./store/settings.store";
import { useLspStore } from "./store/lsp.store";
import type { Workspace } from "./store/workspace.store";
import type { PaneNode } from "./types";
import { applyTheme } from "./lib/themes";
import "overlayscrollbars/overlayscrollbars.css";
import "./styles/globals.css";

applyTheme("cosmos-dark");

function WorkspacePane({
  workspace,
  layout,
  isActive,
}: {
  workspace: Workspace;
  layout: PaneNode;
  isActive: boolean;
}) {
  const contextValue = useMemo(() => ({ workspace, isActive }), [workspace, isActive]);

  return (
    <WorkspaceProvider value={contextValue}>
      <PanePortalProvider layout={layout}>
        <div className={isActive ? "flex w-full h-full min-w-0 min-h-0" : "hidden"}>
          <PaneContainer node={layout} />
        </div>
      </PanePortalProvider>
    </WorkspaceProvider>
  );
}

function App() {
  const layout = useLayoutStore((s) => s.layout);
  const layouts = useLayoutStore((s) => s.layouts);
  const activeWorkspacePath = useLayoutStore((s) => s.activeWorkspacePath);
  const setWorkspace = useLayoutStore((s) => s.setWorkspace);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeIndex = useWorkspaceStore((s) => s.activeIndex);
  const ready = useWorkspaceStore((s) => s.ready);
  const init = useWorkspaceStore((s) => s.init);
  const initSettings = useSettingsStore((s) => s.init);

  useEffect(() => {
    init();
    initSettings();
  }, [init, initSettings]);

  // Sync active workspace path to layout store
  useLayoutEffect(() => {
    if (!ready) return;
    const path = activeIndex !== null ? (workspaces[activeIndex]?.path ?? null) : null;
    setWorkspace(path);
  }, [ready, activeIndex, workspaces, setWorkspace]);

  // Eagerly start LSP servers when a workspace becomes active so they can
  // index the project in the background before any file is opened.
  useEffect(() => {
    if (!ready || activeIndex === null) return;
    const activePath = workspaces[activeIndex]?.path;
    if (activePath) {
      useLspStore.getState().warmupWorkspace(activePath);
    }
  }, [ready, activeIndex, workspaces]);

  // Merge active layout into layouts map for rendering
  const allLayouts = useMemo(() => {
    const result = { ...layouts };
    if (activeWorkspacePath) {
      result[activeWorkspacePath] = layout;
    }
    return result;
  }, [layouts, layout, activeWorkspacePath]);

  if (!ready) return null;

  const hasWorkspace = activeIndex !== null;

  return (
    <div className="font-ui flex flex-col h-screen w-screen overflow-hidden">
      <ProjectBar />
      <div className="flex-1 min-h-0 flex">
        {workspaces.map((ws) => {
          const wsLayout = allLayouts[ws.path];
          if (!wsLayout) return null;
          return (
            <WorkspacePane
              key={ws.path}
              workspace={ws}
              layout={wsLayout}
              isActive={ws.path === activeWorkspacePath}
            />
          );
        })}
        {!hasWorkspace && <EmptyState />}
      </div>
      <StatusBar />
      {hasWorkspace && <DragOverlay />}
      <ToastContainer />
    </div>
  );
}

export default App;
