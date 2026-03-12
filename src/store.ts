import { create } from "zustand";
import type { PaneNode, PaneLeaf, PaneSplit, Tab } from "./types";

let idCounter = 0;
let tabCounter = 0;
const genId = () => `${Date.now()}-${++idCounter}`;

const DEFAULT_ICONS = [
  "file-code",
  "file-text",
  "terminal",
  "git-branch",
  "settings",
  "database",
  "folder-tree",
];

function createTab(title?: string): Tab {
  const idx = Math.floor(Math.random() * DEFAULT_ICONS.length);
  return {
    id: genId(),
    title: title ?? `Tab ${++tabCounter}`,
    icon: DEFAULT_ICONS[idx],
  };
}

function createLeaf(tabs: Tab[] = []): PaneLeaf {
  return {
    id: genId(),
    type: "leaf",
    tabs,
    activeTabId: tabs[0]?.id ?? null,
  };
}

function updateNode(
  node: PaneNode,
  targetId: string,
  updater: (leaf: PaneLeaf) => PaneNode | null,
): PaneNode | null {
  if (node.type === "leaf") {
    if (node.id === targetId) return updater(node);
    return node;
  }
  const newChildren: PaneNode[] = [];
  for (const child of node.children) {
    const result = updateNode(child, targetId, updater);
    if (result) newChildren.push(result);
  }
  if (newChildren.length === 0) return null;
  if (newChildren.length === 1) return newChildren[0];
  return { ...node, children: newChildren, sizes: normalizeSizes(newChildren.length, node.sizes) };
}

function normalizeSizes(count: number, oldSizes: number[]): number[] {
  if (count === oldSizes.length) return oldSizes;
  return Array(count).fill(100 / count);
}

function findLeaf(node: PaneNode, paneId: string): PaneLeaf | null {
  if (node.type === "leaf") return node.id === paneId ? node : null;
  for (const child of node.children) {
    const found = findLeaf(child, paneId);
    if (found) return found;
  }
  return null;
}

interface DragState {
  tab: Tab;
  sourcePaneId: string;
}

interface LayoutStore {
  layout: PaneNode;
  dragState: DragState | null;

  addTab: (paneId: string, title?: string) => void;
  closeTab: (paneId: string, tabId: string) => void;
  setActiveTab: (paneId: string, tabId: string) => void;
  reorderTab: (paneId: string, fromIndex: number, toIndex: number) => void;
  moveTabToPane: (fromPaneId: string, tabId: string, toPaneId: string, index?: number) => void;
  splitPane: (targetPaneId: string, direction: "horizontal" | "vertical", tab: Tab, sourcePaneId: string, position: "before" | "after") => void;
  setPaneSizes: (splitId: string, sizes: number[]) => void;
  setDragState: (data: DragState | null) => void;
}

export const useLayoutStore = create<LayoutStore>((set) => ({
  layout: createLeaf(),
  dragState: null,

  setDragState: (data) => set({ dragState: data }),

  addTab: (paneId, title) =>
    set((state) => {
      const tab = createTab(title);
      const layout = updateNode(state.layout, paneId, (leaf) => ({
        ...leaf,
        tabs: [...leaf.tabs, tab],
        activeTabId: tab.id,
      }));
      return { layout: layout ?? createLeaf() };
    }),

  closeTab: (paneId, tabId) =>
    set((state) => {
      const layout = updateNode(state.layout, paneId, (leaf) => {
        const tabs = leaf.tabs.filter((t) => t.id !== tabId);
        if (tabs.length === 0) return null;
        const activeTabId =
          leaf.activeTabId === tabId
            ? tabs[Math.min(leaf.tabs.findIndex((t) => t.id === tabId), tabs.length - 1)]?.id ?? null
            : leaf.activeTabId;
        return { ...leaf, tabs, activeTabId };
      });
      return { layout: layout ?? createLeaf() };
    }),

  setActiveTab: (paneId, tabId) =>
    set((state) => ({
      layout:
        updateNode(state.layout, paneId, (leaf) => ({
          ...leaf,
          activeTabId: tabId,
        })) ?? state.layout,
    })),

  reorderTab: (paneId, fromIndex, toIndex) =>
    set((state) => ({
      layout:
        updateNode(state.layout, paneId, (leaf) => {
          const tabs = [...leaf.tabs];
          const [moved] = tabs.splice(fromIndex, 1);
          tabs.splice(toIndex, 0, moved);
          return { ...leaf, tabs };
        }) ?? state.layout,
    })),

  moveTabToPane: (fromPaneId, tabId, toPaneId, index) =>
    set((state) => {
      const sourceLeaf = findLeaf(state.layout, fromPaneId);
      if (!sourceLeaf) return state;
      const tab = sourceLeaf.tabs.find((t) => t.id === tabId);
      if (!tab) return state;

      let layout = updateNode(state.layout, fromPaneId, (leaf) => {
        const tabs = leaf.tabs.filter((t) => t.id !== tabId);
        if (tabs.length === 0) return null;
        return {
          ...leaf,
          tabs,
          activeTabId: leaf.activeTabId === tabId ? tabs[0]?.id ?? null : leaf.activeTabId,
        };
      });
      if (!layout) layout = createLeaf();

      layout =
        updateNode(layout, toPaneId, (leaf) => {
          const tabs = [...leaf.tabs];
          const insertAt = index ?? tabs.length;
          tabs.splice(insertAt, 0, tab);
          return { ...leaf, tabs, activeTabId: tab.id };
        }) ?? layout;

      return { layout };
    }),

  splitPane: (targetPaneId, direction, tab, sourcePaneId, position) =>
    set((state) => {
      // Don't split if it's the only tab in the same pane
      const sourceLeaf = findLeaf(state.layout, sourcePaneId);
      if (sourcePaneId === targetPaneId && sourceLeaf && sourceLeaf.tabs.length <= 1) {
        return state;
      }

      let layout = updateNode(state.layout, sourcePaneId, (leaf) => {
        const tabs = leaf.tabs.filter((t) => t.id !== tab.id);
        if (tabs.length === 0 && sourcePaneId !== targetPaneId) return null;
        if (tabs.length === 0) return leaf;
        return {
          ...leaf,
          tabs,
          activeTabId: leaf.activeTabId === tab.id ? tabs[0]?.id ?? null : leaf.activeTabId,
        };
      });
      if (!layout) layout = createLeaf();

      const newLeaf = createLeaf([tab]);
      layout =
        updateNode(layout, targetPaneId, (leaf) => {
          const children = position === "before" ? [newLeaf, leaf] : [leaf, newLeaf];
          const split: PaneSplit = {
            id: genId(),
            type: "split",
            direction,
            children,
            sizes: [50, 50],
          };
          return split;
        }) ?? layout;

      return { layout };
    }),

  setPaneSizes: (splitId, sizes) =>
    set((state) => {
      function update(node: PaneNode): PaneNode {
        if (node.type === "leaf") return node;
        if (node.id === splitId) return { ...node, sizes };
        return { ...node, children: node.children.map(update) };
      }
      return { layout: update(state.layout) };
    }),
}));
