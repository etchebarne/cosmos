import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { invoke } from "@tauri-apps/api/core";
import { useLayoutStore } from "../../store/layout.store";
import { useDragStore } from "../../store/drag.store";
import { useInfinityStore } from "../../store/infinity.store";
import { findLeaf, findAllLeaves } from "../../lib/pane-tree";
import type { DropZone } from "../../types";

interface DropTarget {
  type: "tab-bar" | "pane-zone" | "infinity" | "directory";
  paneId?: string;
  infinityTabId?: string;
  dirPath?: string;
  index?: number;
  zone?: DropZone;
  indicatorX?: number;
  rect: DOMRect;
}

function computeDropTarget(x: number, y: number, isFileDrag: boolean): DropTarget | null {
  const elements = document.elementsFromPoint(x, y);

  // Check tab bar first (higher priority)
  for (const el of elements) {
    const paneId = (el as HTMLElement).dataset?.tabbarPane;
    if (paneId) {
      const tabElements = (el as HTMLElement).querySelectorAll<HTMLElement>("[data-tab]");
      let index = tabElements.length;
      let indicatorX = (el as HTMLElement).getBoundingClientRect().left;

      for (let i = 0; i < tabElements.length; i++) {
        const tabRect = tabElements[i].getBoundingClientRect();
        if (x < tabRect.left + tabRect.width / 2) {
          index = i;
          indicatorX = tabRect.left;
          break;
        }
        indicatorX = tabRect.right;
      }

      return {
        type: "tab-bar",
        paneId,
        index,
        indicatorX,
        rect: (el as HTMLElement).getBoundingClientRect(),
      };
    }
  }

  if (isFileDrag) {
    // Check directory targets in file tree (file drag only)
    for (const el of elements) {
      const dirPath = (el as HTMLElement).dataset?.dirPath;
      if (dirPath) {
        return {
          type: "directory",
          dirPath,
          rect: (el as HTMLElement).getBoundingClientRect(),
        };
      }
    }

    // Check infinity canvas (file drag only)
    for (const el of elements) {
      const infinityTabId = (el as HTMLElement).dataset?.infinityTab;
      if (infinityTabId) {
        return {
          type: "infinity",
          infinityTabId,
          rect: (el as HTMLElement).getBoundingClientRect(),
        };
      }
    }
  }

  // Check pane content area
  for (const el of elements) {
    const paneId = (el as HTMLElement).dataset?.paneContent;
    if (paneId) {
      const rect = (el as HTMLElement).getBoundingClientRect();
      const rx = (x - rect.left) / rect.width;
      const ry = (y - rect.top) / rect.height;
      const threshold = 0.25;

      let zone: DropZone = "center";
      if (rx < threshold) zone = "left";
      else if (rx > 1 - threshold) zone = "right";
      else if (ry < threshold) zone = "top";
      else if (ry > 1 - threshold) zone = "bottom";

      return { type: "pane-zone", paneId, zone, rect };
    }
  }

  return null;
}

function getZoneOverlayStyle(zone: DropZone, rect: DOMRect): React.CSSProperties {
  const pad = 4;
  switch (zone) {
    case "left":
      return {
        left: rect.left + pad,
        top: rect.top + pad,
        width: rect.width / 2 - pad * 2,
        height: rect.height - pad * 2,
      };
    case "right":
      return {
        left: rect.left + rect.width / 2 + pad,
        top: rect.top + pad,
        width: rect.width / 2 - pad * 2,
        height: rect.height - pad * 2,
      };
    case "top":
      return {
        left: rect.left + pad,
        top: rect.top + pad,
        width: rect.width - pad * 2,
        height: rect.height / 2 - pad * 2,
      };
    case "bottom":
      return {
        left: rect.left + pad,
        top: rect.top + rect.height / 2 + pad,
        width: rect.width - pad * 2,
        height: rect.height / 2 - pad * 2,
      };
    default:
      return {
        left: rect.left + pad,
        top: rect.top + pad,
        width: rect.width - pad * 2,
        height: rect.height - pad * 2,
      };
  }
}

export function DragOverlay() {
  const dragState = useDragStore((s) => s.dragState);
  const [mousePos, setMousePos] = useState({ x: 0, y: 0 });
  const [dropTarget, setDropTarget] = useState<DropTarget | null>(null);
  const dropTargetRef = useRef<DropTarget | null>(null);

  // Keep ref in sync for mouseup handler
  useEffect(() => {
    dropTargetRef.current = dropTarget;
  });

  useEffect(() => {
    if (!dragState) {
      setDropTarget(null);
      return;
    }

    const isFileDrag = dragState.type === "file";

    const onMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
      setDropTarget(computeDropTarget(e.clientX, e.clientY, isFileDrag));
    };

    const onMouseUp = (e: MouseEvent) => {
      const target = dropTargetRef.current;
      const dragged = useDragStore.getState().dragState;

      if (target && dragged) {
        if (dragged.type === "tab") {
          // ── Tab drag ──
          const store = useLayoutStore.getState();

          if (target.type === "tab-bar" && target.paneId) {
            if (target.paneId === dragged.sourcePaneId) {
              const leaf = findLeaf(store.layout, dragged.sourcePaneId);
              if (leaf) {
                const fromIndex = leaf.tabs.findIndex((t) => t.id === dragged.tab.id);
                const toIndex = target.index ?? leaf.tabs.length;
                const adjusted = fromIndex < toIndex ? toIndex - 1 : toIndex;
                if (fromIndex !== adjusted) {
                  store.reorderTab(target.paneId, fromIndex, adjusted);
                }
              }
            } else {
              store.moveTabToPane(
                dragged.sourcePaneId,
                dragged.tab.id,
                target.paneId,
                target.index,
              );
            }
          } else if (target.type === "pane-zone" && target.zone && target.paneId) {
            if (target.zone === "center") {
              if (target.paneId !== dragged.sourcePaneId) {
                store.moveTabToPane(dragged.sourcePaneId, dragged.tab.id, target.paneId);
              }
            } else {
              const direction: "horizontal" | "vertical" =
                target.zone === "left" || target.zone === "right" ? "horizontal" : "vertical";
              const position: "before" | "after" =
                target.zone === "left" || target.zone === "top" ? "before" : "after";
              store.splitPane(
                target.paneId,
                direction,
                dragged.tab,
                dragged.sourcePaneId,
                position,
              );
            }
          }
        } else if (dragged.type === "file") {
          // ── File drag ──
          const { filePath, fileName } = dragged;

          // Find existing instances before opening (so we can close them after)
          let existingTab: { paneId: string; tabId: string } | null = null;
          let existingNode: { canvasId: string; nodeId: string } | null = null;

          if (target.type !== "directory") {
            const leaves = findAllLeaves(useLayoutStore.getState().layout);
            for (const leaf of leaves) {
              const tab = leaf.tabs.find(
                (t) => t.type === "editor" && (t.metadata?.filePath as string) === filePath,
              );
              if (tab) {
                existingTab = { paneId: leaf.id, tabId: tab.id };
                break;
              }
            }

            for (const [canvasId, nodes] of Object.entries(useInfinityStore.getState().canvases)) {
              const node = nodes.find(
                (n) =>
                  n.data.tabType === "editor" && (n.data.metadata?.filePath as string) === filePath,
              );
              if (node) {
                existingNode = { canvasId, nodeId: node.id };
                break;
              }
            }
          }

          // Open at new location first
          if (target.type === "directory" && target.dirPath) {
            // Drop on directory → move file
            invoke("move_file", { source: filePath, destDir: target.dirPath })
              .then(() => {
                window.dispatchEvent(
                  new CustomEvent("file-tree-move", {
                    detail: { sourcePath: filePath, destDir: target.dirPath, fileName },
                  }),
                );
              })
              .catch((err: unknown) => console.error("Failed to move file:", err));
          } else if (target.type === "infinity" && target.infinityTabId) {
            // Drop on infinity canvas → add editor node
            const instance = useInfinityStore.getState().instances[target.infinityTabId];
            if (instance) {
              const pos = instance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
              useInfinityStore
                .getState()
                .addNode(target.infinityTabId, "editor", pos, fileName, { filePath });
            }
          } else if (target.type === "tab-bar" && target.paneId) {
            // Drop on tab bar → open as editor tab
            useLayoutStore.getState().addTab(target.paneId, "editor", fileName, { filePath });
          } else if (target.type === "pane-zone" && target.zone && target.paneId) {
            if (target.zone === "center") {
              useLayoutStore.getState().addTab(target.paneId, "editor", fileName, { filePath });
            } else {
              const direction: "horizontal" | "vertical" =
                target.zone === "left" || target.zone === "right" ? "horizontal" : "vertical";
              const position: "before" | "after" =
                target.zone === "left" || target.zone === "top" ? "before" : "after";
              useLayoutStore
                .getState()
                .insertSplit(target.paneId, direction, position, "editor", fileName, { filePath });
            }
          }

          // Close old instances after opening the new one
          if (existingTab) {
            useLayoutStore.getState().closeTab(existingTab.paneId, existingTab.tabId);
          }
          if (existingNode) {
            useInfinityStore.getState().removeNode(existingNode.canvasId, existingNode.nodeId);
          }
        }
      }

      useDragStore.getState().setDragState(null);
      setDropTarget(null);
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);

    return () => {
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
    };
  }, [dragState]);

  if (!dragState) return null;

  const ghostLabel = dragState.type === "tab" ? dragState.tab.title : dragState.fileName;

  return createPortal(
    <div className="fixed inset-0 z-50" style={{ cursor: "grabbing" }}>
      {/* Ghost tab */}
      <div
        className="absolute flex items-center gap-2 px-3 h-8 bg-[var(--color-tab-active-bg)] border border-[var(--color-accent-blue)] text-xs text-[var(--color-text-primary)] opacity-90 pointer-events-none"
        style={{ left: mousePos.x + 12, top: mousePos.y - 16 }}
      >
        {ghostLabel}
      </div>

      {/* Directory highlight overlay */}
      {dropTarget?.type === "directory" && (
        <div
          className="absolute bg-[var(--color-accent-blue-muted)] border border-[var(--color-accent-blue)] pointer-events-none"
          style={{
            left: dropTarget.rect.left,
            top: dropTarget.rect.top,
            width: dropTarget.rect.width,
            height: dropTarget.rect.height,
          }}
        />
      )}

      {/* Pane zone overlay */}
      {dropTarget?.type === "pane-zone" && dropTarget.zone && dropTarget.zone !== "center" && (
        <div
          className="absolute bg-[var(--color-accent-blue-muted)] border-2 border-[var(--color-accent-blue)] pointer-events-none"
          style={getZoneOverlayStyle(dropTarget.zone, dropTarget.rect)}
        />
      )}

      {/* Pane center overlay */}
      {dropTarget?.type === "pane-zone" && dropTarget.zone === "center" && (
        <div
          className="absolute bg-[var(--color-accent-blue-muted)] border-2 border-dashed border-[var(--color-accent-blue)] pointer-events-none"
          style={getZoneOverlayStyle("center", dropTarget.rect)}
        />
      )}

      {/* Infinity canvas overlay */}
      {dropTarget?.type === "infinity" && (
        <div
          className="absolute bg-[var(--color-accent-blue-muted)] border-2 border-dashed border-[var(--color-accent-blue)] pointer-events-none"
          style={getZoneOverlayStyle("center", dropTarget.rect)}
        />
      )}

      {/* Tab bar insertion indicator */}
      {dropTarget?.type === "tab-bar" && dropTarget.indicatorX !== undefined && (
        <div
          className="absolute w-0.5 bg-[var(--color-accent-blue)] pointer-events-none"
          style={{
            left: dropTarget.indicatorX - 1,
            top: dropTarget.rect.top,
            height: dropTarget.rect.height,
          }}
        />
      )}
    </div>,
    document.body,
  );
}
