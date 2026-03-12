import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { useWorkspaceStore } from "../../workspace-store";
import { FileTreeNode } from "./FileTreeNode";
import { ScrollArea } from "../../components/shared/ScrollArea";
import type { TabContentProps } from "../types";

export interface DirEntry {
  name: string;
  path: string;
  isDir: boolean;
  extension: string | null;
}

export function FileTreeTab({ tab: _tab, paneId: _paneId }: TabContentProps) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeIndex = useWorkspaceStore((s) => s.activeIndex);
  const activeWorkspace =
    activeIndex !== null ? workspaces[activeIndex] : null;

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

  if (!activeWorkspace) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-[var(--color-text-muted)]">
          No workspace open
        </p>
      </div>
    );
  }

  if (loading && entries.length === 0) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-[var(--color-text-secondary)]">
          Loading...
        </p>
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
      <div className="pt-1 pb-4">
        <FileTreeNode
          entry={rootEntry}
          depth={0}
          defaultExpanded
          preloadedChildren={entries}
        />
      </div>
    </ScrollArea>
  );
}
