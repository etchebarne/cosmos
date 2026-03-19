// ── Tab & Pane tree ──

export interface EditorTabMetadata {
  filePath: string;
}

export interface ChangesTabMetadata {
  filePath: string;
  staged: boolean;
  isUntracked: boolean;
}

export interface Tab {
  id: string;
  type: string;
  title: string;
  icon: string;
  metadata?: Record<string, unknown>;
}

/** Type-safe accessor for editor tab metadata. */
export function getEditorMeta(tab: Tab): EditorTabMetadata | undefined {
  if (tab.type === "editor" && tab.metadata?.filePath) {
    return tab.metadata as unknown as EditorTabMetadata;
  }
}

/** Type-safe accessor for changes tab metadata. */
export function getChangesMeta(tab: Tab): ChangesTabMetadata | undefined {
  if (tab.type === "changes" && tab.metadata?.filePath) {
    return tab.metadata as unknown as ChangesTabMetadata;
  }
}

export interface PaneLeaf {
  id: string;
  type: "leaf";
  tabs: Tab[];
  activeTabId: string | null;
}

export interface PaneSplit {
  id: string;
  type: "split";
  direction: "horizontal" | "vertical";
  children: PaneNode[];
  sizes: number[];
}

export type PaneNode = PaneLeaf | PaneSplit;

// ── Drag & Drop ──

export type DropZone = "left" | "right" | "top" | "bottom" | "center";

export interface TabDragState {
  type: "tab";
  tab: Tab;
  sourcePaneId: string;
}

export interface FileDragState {
  type: "file";
  files: Array<{ filePath: string; fileName: string; isDir?: boolean }>;
}

export interface ChangesDragState {
  type: "changes";
  filePath: string;
  fileName: string;
  staged: boolean;
  isUntracked: boolean;
}

export type DragState = TabDragState | FileDragState | ChangesDragState;
