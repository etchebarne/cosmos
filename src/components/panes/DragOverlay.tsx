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

function computeDropTarget(
  x: number,
  y: number,
  isFileDrag: boolean,
  allowDirectory?: boolean,
): DropTarget | null {
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
    // Check directory targets in file tree (file drag only, not changes drag)
    if (allowDirectory)
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
  dropTargetRef.current = dropTarget;

  useEffect(() => {
    if (!dragState) {
      setDropTarget(null);
      return;
    }

    const isFileDrag = dragState.type === "file" || dragState.type === "changes";
    const allowDirectory = dragState.type === "file";

    const onMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
      setDropTarget(computeDropTarget(e.clientX, e.clientY, isFileDrag, allowDirectory));
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
          // ── File drag (single or multi) ──
          const { files } = dragged;

          if (target.type === "directory" && target.dirPath) {
            // Move all files to directory
            for (const { filePath, fileName } of files) {
              invoke("move_file", { source: filePath, destDir: target.dirPath })
                .then(() => {
                  window.dispatchEvent(
                    new CustomEvent("file-tree-move", {
                      detail: { sourcePath: filePath, destDir: target.dirPath, fileName },
                    }),
                  );
                })
                .catch((err: unknown) => console.error("Failed to move file:", err));
            }
          } else {
            // Only open files (not directories) as editor tabs
            const openableFiles = files.filter((f) => !f.isDir);

            if (openableFiles.length > 0) {
              // Find existing instances for dedup
              const existingInstances: Array<{
                tab?: { paneId: string; tabId: string };
                node?: { canvasId: string; nodeId: string };
              }> = [];

              const leaves = findAllLeaves(useLayoutStore.getState().layout);
              const canvases = Object.entries(useInfinityStore.getState().canvases);

              for (const { filePath } of openableFiles) {
                let existingTab: { paneId: string; tabId: string } | undefined;
                let existingNode: { canvasId: string; nodeId: string } | undefined;

                for (const leaf of leaves) {
                  const tab = leaf.tabs.find(
                    (t) => t.type === "editor" && (t.metadata?.filePath as string) === filePath,
                  );
                  if (tab) {
                    existingTab = { paneId: leaf.id, tabId: tab.id };
                    break;
                  }
                }

                for (const [canvasId, nodes] of canvases) {
                  const node = nodes.find(
                    (n) =>
                      n.data.tabType === "editor" &&
                      (n.data.metadata?.filePath as string) === filePath,
                  );
                  if (node) {
                    existingNode = { canvasId, nodeId: node.id };
                    break;
                  }
                }

                existingInstances.push({ tab: existingTab, node: existingNode });
              }

              // Open at new location
              if (target.type === "infinity" && target.infinityTabId) {
                const instance = useInfinityStore.getState().instances[target.infinityTabId];
                if (instance) {
                  const basePos = instance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
                  openableFiles.forEach(({ filePath, fileName }, i) => {
                    const pos = { x: basePos.x + i * 30, y: basePos.y + i * 30 };
                    useInfinityStore
                      .getState()
                      .addNode(target.infinityTabId!, "editor", pos, fileName, { filePath });
                  });
                }
              } else if (target.type === "tab-bar" && target.paneId) {
                for (const { filePath, fileName } of openableFiles) {
                  useLayoutStore
                    .getState()
                    .addTab(target.paneId!, "editor", fileName, { filePath });
                }
              } else if (target.type === "pane-zone" && target.zone && target.paneId) {
                if (target.zone === "center" || openableFiles.length > 1) {
                  for (const { filePath, fileName } of openableFiles) {
                    useLayoutStore
                      .getState()
                      .addTab(target.paneId!, "editor", fileName, { filePath });
                  }
                } else {
                  const { filePath, fileName } = openableFiles[0];
                  const direction: "horizontal" | "vertical" =
                    target.zone === "left" || target.zone === "right" ? "horizontal" : "vertical";
                  const position: "before" | "after" =
                    target.zone === "left" || target.zone === "top" ? "before" : "after";
                  useLayoutStore
                    .getState()
                    .insertSplit(target.paneId!, direction, position, "editor", fileName, {
                      filePath,
                    });
                }
              }

              // Close old instances
              for (const { tab, node } of existingInstances) {
                if (tab) {
                  useLayoutStore.getState().closeTab(tab.paneId, tab.tabId);
                }
                if (node) {
                  useInfinityStore.getState().removeNode(node.canvasId, node.nodeId);
                }
              }
            }
          }
        } else if (dragged.type === "changes") {
          // ── Changes drag ──
          const { filePath, fileName, staged, isUntracked } = dragged;
          const changesMetadata = { filePath, staged, isUntracked };

          // Find existing changes tab for this file
          let existingChangesTab: { paneId: string; tabId: string } | null = null;
          const leaves = findAllLeaves(useLayoutStore.getState().layout);
          for (const leaf of leaves) {
            const tab = leaf.tabs.find(
              (t) => t.type === "changes" && (t.metadata?.filePath as string) === filePath,
            );
            if (tab) {
              existingChangesTab = { paneId: leaf.id, tabId: tab.id };
              break;
            }
          }

          let existingChangesNode: { canvasId: string; nodeId: string } | null = null;
          for (const [canvasId, nodes] of Object.entries(useInfinityStore.getState().canvases)) {
            const node = nodes.find(
              (n) =>
                n.data.tabType === "changes" && (n.data.metadata?.filePath as string) === filePath,
            );
            if (node) {
              existingChangesNode = { canvasId, nodeId: node.id };
              break;
            }
          }

          if (target.type === "infinity" && target.infinityTabId) {
            const instance = useInfinityStore.getState().instances[target.infinityTabId];
            if (instance) {
              const pos = instance.screenToFlowPosition({ x: e.clientX, y: e.clientY });
              useInfinityStore
                .getState()
                .addNode(target.infinityTabId, "changes", pos, fileName, changesMetadata);
            }
          } else if (target.type === "tab-bar" && target.paneId) {
            useLayoutStore.getState().addTab(target.paneId, "changes", fileName, changesMetadata);
          } else if (target.type === "pane-zone" && target.zone && target.paneId) {
            if (target.zone === "center") {
              useLayoutStore.getState().addTab(target.paneId, "changes", fileName, changesMetadata);
            } else {
              const direction: "horizontal" | "vertical" =
                target.zone === "left" || target.zone === "right" ? "horizontal" : "vertical";
              const position: "before" | "after" =
                target.zone === "left" || target.zone === "top" ? "before" : "after";
              useLayoutStore
                .getState()
                .insertSplit(
                  target.paneId,
                  direction,
                  position,
                  "changes",
                  fileName,
                  changesMetadata,
                );
            }
          }

          // Close old instances
          if (existingChangesTab) {
            useLayoutStore.getState().closeTab(existingChangesTab.paneId, existingChangesTab.tabId);
          }
          if (existingChangesNode) {
            useInfinityStore
              .getState()
              .removeNode(existingChangesNode.canvasId, existingChangesNode.nodeId);
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

  const ghostLabel =
    dragState.type === "tab"
      ? dragState.tab.title
      : dragState.type === "file"
        ? dragState.files.length > 1
          ? `${dragState.files.length} items`
          : dragState.files[0].fileName
        : dragState.fileName;

  return createPortal(
    <div className="fixed inset-0 z-50" style={{ cursor: "grabbing" }}>
      {/* Ghost tab */}
      <div
        className="absolute flex items-center gap-2 px-3 h-8 bg-[var(--color-bg-elevated)] border border-[var(--color-accent-blue)] text-xs text-[var(--color-text-primary)] pointer-events-none animate-lift"
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
