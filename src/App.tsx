import { useEffect, useLayoutEffect } from "react";
import { ProjectBar } from "./components/layout/ProjectBar";
import { StatusBar } from "./components/layout/StatusBar";
import { EmptyState } from "./components/layout/EmptyState";
import { PaneContainer } from "./components/panes/PaneContainer";
import { DragOverlay } from "./components/panes/DragOverlay";
import { useLayoutStore } from "./store";
import { useWorkspaceStore } from "./workspace-store";
import "overlayscrollbars/overlayscrollbars.css";
import "./globals.css";

function App() {
  const layout = useLayoutStore((s) => s.layout);
  const setWorkspace = useLayoutStore((s) => s.setWorkspace);
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeIndex = useWorkspaceStore((s) => s.activeIndex);
  const ready = useWorkspaceStore((s) => s.ready);
  const init = useWorkspaceStore((s) => s.init);

  useEffect(() => {
    init();
  }, [init]);

  // Sync active workspace path to layout store
  useLayoutEffect(() => {
    if (!ready) return;
    const path =
      activeIndex !== null ? workspaces[activeIndex]?.path ?? null : null;
    setWorkspace(path);
  }, [ready, activeIndex, workspaces, setWorkspace]);

  if (!ready) return null;

  const hasWorkspace = activeIndex !== null;

  return (
    <div className="font-ui flex flex-col h-screen w-screen overflow-hidden">
      <ProjectBar />
      <div className="flex-1 min-h-0 flex">
        {hasWorkspace ? <PaneContainer node={layout} /> : <EmptyState />}
      </div>
      <StatusBar />
      {hasWorkspace && <DragOverlay />}
    </div>
  );
}

export default App;
