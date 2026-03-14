import { create } from "zustand";
import type { PaneNode, PaneSplit, Tab, DragState } from "./types";
import { genId, createTab, createLeaf, findLeaf, findAllLeaves, updateNode } from "./lib/pane-tree";
import "./tabs"; // Initialize tab registry
import { getTabDefinition } from "./tabs";

interface LayoutStore {
  layout: PaneNode;
  layouts: Record<string, PaneNode>;
  activeWorkspacePath: string | null;
  dragState: DragState | null;
  lastEditorPaneId: string | null;
  activePaneId: string | null;

  setWorkspace: (path: string | null) => void;
  addTab: (paneId: string, type?: string, title?: string) => void;
  closeTab: (paneId: string, tabId: string) => void;
  setActiveTab: (paneId: string, tabId: string) => void;
  reorderTab: (paneId: string, fromIndex: number, toIndex: number) => void;
  moveTabToPane: (fromPaneId: string, tabId: string, toPaneId: string, index?: number) => void;
  transformTab: (paneId: string, tabId: string, newType: string) => void;
  splitPane: (
    targetPaneId: string,
    direction: "horizontal" | "vertical",
    tab: Tab,
    sourcePaneId: string,
    position: "before" | "after",
  ) => void;
  setPaneSizes: (splitId: string, sizes: number[]) => void;
  setDragState: (data: DragState | null) => void;
  openFile: (filePath: string, fileName: string, sourcePaneId: string) => void;
}

export const useLayoutStore = create<LayoutStore>((set) => ({
  layout: createLeaf(),
  layouts: {},
  activeWorkspacePath: null,
  dragState: null,
  lastEditorPaneId: null,
  activePaneId: null,

  setWorkspace: (path) =>
    set((state) => {
      // Save current layout
      const layouts = { ...state.layouts };
      if (state.activeWorkspacePath) {
        layouts[state.activeWorkspacePath] = state.layout;
      }

      // Load or create layout for new workspace
      const layout = path ? (layouts[path] ?? createLeaf()) : createLeaf();
      return { layouts, layout, activeWorkspacePath: path, dragState: null };
    }),

  setDragState: (data) => set({ dragState: data }),

  addTab: (paneId, type = "blank", title) =>
    set((state) => {
      const tab = createTab(type, title);
      const layout = updateNode(state.layout, paneId, (leaf) => ({
        ...leaf,
        tabs: [...leaf.tabs, tab],
        activeTabId: tab.id,
      }));
      return { layout: layout ?? createLeaf() };
    }),

  transformTab: (paneId, tabId, newType) =>
    set((state) => {
      const definition = getTabDefinition(newType);
      if (!definition) return state;
      const layout = updateNode(state.layout, paneId, (leaf) => ({
        ...leaf,
        tabs: leaf.tabs.map((t) =>
          t.id === tabId
            ? { ...t, type: newType, title: definition.title, icon: definition.icon }
            : t,
        ),
      }));
      return { layout: layout ?? state.layout };
    }),

  closeTab: (paneId, tabId) =>
    set((state) => {
      const layout = updateNode(state.layout, paneId, (leaf) => {
        const tabs = leaf.tabs.filter((t) => t.id !== tabId);
        if (tabs.length === 0) return null;
        const activeTabId =
          leaf.activeTabId === tabId
            ? (tabs[
                Math.min(
                  leaf.tabs.findIndex((t) => t.id === tabId),
                  tabs.length - 1,
                )
              ]?.id ?? null)
            : leaf.activeTabId;
        return { ...leaf, tabs, activeTabId };
      });
      return { layout: layout ?? createLeaf() };
    }),

  setActiveTab: (paneId, tabId) =>
    set((state) => ({
      activePaneId: paneId,
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
          activeTabId: leaf.activeTabId === tabId ? (tabs[0]?.id ?? null) : leaf.activeTabId,
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
          activeTabId: leaf.activeTabId === tab.id ? (tabs[0]?.id ?? null) : leaf.activeTabId,
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

  openFile: (filePath, fileName, sourcePaneId) =>
    set((state) => {
      const leaves = findAllLeaves(state.layout);

      // Check if file is already open in any pane
      for (const leaf of leaves) {
        const existing = leaf.tabs.find(
          (t) => t.type === "editor" && (t.metadata?.filePath as string) === filePath,
        );
        if (existing) {
          // Focus the existing tab
          const layout =
            updateNode(state.layout, leaf.id, (l) => ({
              ...l,
              activeTabId: existing.id,
            })) ?? state.layout;
          return { layout, lastEditorPaneId: leaf.id, activePaneId: leaf.id };
        }
      }

      const tab = createTab("editor", fileName, { filePath });

      // Find panes that already have editor tabs
      const editorPanes = leaves.filter((leaf) => leaf.tabs.some((t) => t.type === "editor"));

      let targetPaneId: string | null = null;

      if (editorPanes.length === 1) {
        targetPaneId = editorPanes[0].id;
      } else if (editorPanes.length > 1) {
        // Prefer the last-used editor pane if it still has editor tabs
        const lastUsed = editorPanes.find((p) => p.id === state.lastEditorPaneId);
        targetPaneId = lastUsed ? lastUsed.id : editorPanes[0].id;
      }

      if (targetPaneId) {
        // Add tab to existing editor pane
        const layout =
          updateNode(state.layout, targetPaneId, (leaf) => ({
            ...leaf,
            tabs: [...leaf.tabs, tab],
            activeTabId: tab.id,
          })) ?? state.layout;
        return { layout, lastEditorPaneId: targetPaneId, activePaneId: targetPaneId };
      }

      // No editor pane exists — split from source pane
      const newLeaf = createLeaf([tab]);
      const layout =
        updateNode(state.layout, sourcePaneId, (leaf) => {
          const split: PaneSplit = {
            id: genId(),
            type: "split",
            direction: "horizontal",
            children: [leaf, newLeaf],
            sizes: [50, 50],
          };
          return split;
        }) ?? state.layout;

      return { layout, lastEditorPaneId: newLeaf.id, activePaneId: newLeaf.id };
    }),
}));
