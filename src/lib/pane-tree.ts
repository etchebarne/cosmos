import type { PaneNode, PaneLeaf, Tab } from "../types";

let idCounter = 0;
export const genId = () => `${Date.now()}-${++idCounter}`;

let tabCounter = 0;

const DEFAULT_ICONS = [
  "file-code",
  "file-text",
  "terminal",
  "git-branch",
  "settings",
  "database",
  "folder-tree",
];

export function createTab(title?: string): Tab {
  const idx = Math.floor(Math.random() * DEFAULT_ICONS.length);
  return {
    id: genId(),
    title: title ?? `Tab ${++tabCounter}`,
    icon: DEFAULT_ICONS[idx],
  };
}

export function createLeaf(tabs: Tab[] = []): PaneLeaf {
  return {
    id: genId(),
    type: "leaf",
    tabs,
    activeTabId: tabs[0]?.id ?? null,
  };
}

export function findLeaf(node: PaneNode, paneId: string): PaneLeaf | null {
  if (node.type === "leaf") return node.id === paneId ? node : null;
  for (const child of node.children) {
    const found = findLeaf(child, paneId);
    if (found) return found;
  }
  return null;
}

/**
 * Recursively walk the pane tree to find and update a specific leaf node.
 * The updater can return `null` to remove the leaf (e.g. when its last tab is closed).
 * Parent splits are automatically collapsed when reduced to a single child.
 */
export function updateNode(
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

  return {
    ...node,
    children: newChildren,
    sizes: normalizeSizes(newChildren.length, node.sizes),
  };
}

function normalizeSizes(count: number, oldSizes: number[]): number[] {
  if (count === oldSizes.length) return oldSizes;
  return Array(count).fill(100 / count);
}
