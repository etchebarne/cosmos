// ── Tab & Pane tree ──

export interface Tab {
  id: string;
  type: string;
  title: string;
  icon: string;
  metadata?: Record<string, unknown>;
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
  filePath: string;
  fileName: string;
}

export type DragState = TabDragState | FileDragState;
