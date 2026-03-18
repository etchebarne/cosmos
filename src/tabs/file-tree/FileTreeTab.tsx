import { useEffect, useCallback, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useActiveWorkspace } from "../../contexts/WorkspaceContext";
import { FileTreeNode, useFileTreeSelection } from "./FileTreeNode";
import { ScrollArea } from "../../components/shared/ScrollArea";
import type { TabContentProps } from "../types";

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  extension: string | null;
}

export function FileTreeTab({ tab: _tab, paneId }: TabContentProps) {
  const activeWorkspace = useActiveWorkspace();

  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const loadRoot = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<DirEntry[]>("read_dir", {
        path: activeWorkspace.path,
      });
      setEntries(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    loadRoot();
  }, [loadRoot]);

  // Clear selection when clicking outside the file tree
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      const target = e.target as HTMLElement;
      if (!target.closest("[data-file-tree]")) {
        useFileTreeSelection.getState().clear();
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Start filesystem watcher for the workspace
  useEffect(() => {
    if (!activeWorkspace) return;
    invoke("watch_workspace", { path: activeWorkspace.path });
    return () => {
      invoke("unwatch_workspace", { path: activeWorkspace.path });
    };
  }, [activeWorkspace]);

  if (!activeWorkspace) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-[var(--color-text-muted)]">No workspace open</p>
      </div>
    );
  }

  if (loading && entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-[var(--color-text-secondary)]">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-[var(--color-status-red)]">{error}</p>
      </div>
    );
  }

  const rootEntry: DirEntry = {
    name: activeWorkspace.name,
    path: activeWorkspace.path,
    isDir: true,
    extension: null,
  };

  return (
    <ScrollArea className="h-full font-ui">
      <div className="pt-1 pb-4 min-h-full" data-file-tree>
        <FileTreeNode
          entry={rootEntry}
          depth={0}
          paneId={paneId}
          defaultExpanded
          preloadedChildren={entries}
        />
      </div>
    </ScrollArea>
  );
}
