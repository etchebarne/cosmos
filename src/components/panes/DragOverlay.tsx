import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLayoutStore } from "../../store";
import { findLeaf } from "../../lib/pane-tree";
import type { DropZone } from "../../types";

interface DropTarget {
  type: "tab-bar" | "pane-zone";
  paneId: string;
  index?: number;
  zone?: DropZone;
  indicatorX?: number;
  rect: DOMRect;
}

function computeDropTarget(x: number, y: number): DropTarget | null {
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
  const dragState = useLayoutStore((s) => s.dragState);
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

    const onMouseMove = (e: MouseEvent) => {
      setMousePos({ x: e.clientX, y: e.clientY });
      setDropTarget(computeDropTarget(e.clientX, e.clientY));
    };

    const onMouseUp = () => {
      const target = dropTargetRef.current;
      const dragged = useLayoutStore.getState().dragState;

      if (target && dragged) {
        const store = useLayoutStore.getState();

        if (target.type === "tab-bar") {
          if (target.paneId === dragged.sourcePaneId) {
            // Reorder within same pane
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
            // Move to different pane's tab bar
            store.moveTabToPane(dragged.sourcePaneId, dragged.tab.id, target.paneId, target.index);
          }
        } else if (target.type === "pane-zone" && target.zone) {
          if (target.zone === "center") {
            if (target.paneId !== dragged.sourcePaneId) {
              store.moveTabToPane(dragged.sourcePaneId, dragged.tab.id, target.paneId);
            }
          } else {
            const direction: "horizontal" | "vertical" =
              target.zone === "left" || target.zone === "right" ? "horizontal" : "vertical";
            const position: "before" | "after" =
              target.zone === "left" || target.zone === "top" ? "before" : "after";
            store.splitPane(target.paneId, direction, dragged.tab, dragged.sourcePaneId, position);
          }
        }
      }

      useLayoutStore.getState().setDragState(null);
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

  return createPortal(
    <div className="fixed inset-0 z-50" style={{ cursor: "grabbing" }}>
      {/* Ghost tab */}
      <div
        className="absolute flex items-center gap-2 px-3 h-8 bg-[var(--color-tab-active-bg)] border border-[var(--color-accent-blue)] text-xs text-[var(--color-text-primary)] opacity-90 pointer-events-none"
        style={{ left: mousePos.x + 12, top: mousePos.y - 16 }}
      >
        {dragState.tab.title}
      </div>

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
