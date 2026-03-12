export interface Tab {
  id: string;
  title: string;
  icon: string;
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

export type DropZone = "left" | "right" | "top" | "bottom" | "center";
