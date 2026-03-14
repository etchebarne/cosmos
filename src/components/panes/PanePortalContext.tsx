import { createContext, useContext, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { findAllLeaves } from "../../lib/pane-tree";
import { TabContent } from "./TabContent";
import type { PaneNode } from "../../types";

/**
 * Manages stable DOM containers for each pane.
 * Each pane gets a persistent <div> that is reused across tree restructuring.
 * Portal content renders into these stable divs, so React never unmounts
 * the tab components — even when the pane tree changes shape.
 */
class PaneContainerRegistry {
  private containers = new Map<string, HTMLDivElement>();
  private scrollSnapshots = new Map<string, { el: Element; top: number; left: number }[]>();

  get(paneId: string): HTMLDivElement {
    let el = this.containers.get(paneId);
    if (!el) {
      el = document.createElement("div");
      el.style.height = "100%";
      this.containers.set(paneId, el);
    }
    return el;
  }

  /** Capture scroll positions while the container is still in the live DOM. */
  saveScroll(paneId: string) {
    const container = this.containers.get(paneId);
    if (!container || !container.isConnected) return;
    const saved: { el: Element; top: number; left: number }[] = [];
    container.querySelectorAll("*").forEach((el) => {
      if (el.scrollTop || el.scrollLeft) {
        saved.push({ el, top: el.scrollTop, left: el.scrollLeft });
      }
    });
    this.scrollSnapshots.set(paneId, saved);
  }

  /** Restore previously captured scroll positions. */
  restoreScroll(paneId: string) {
    const saved = this.scrollSnapshots.get(paneId);
    if (!saved) return;
    for (const { el, top, left } of saved) {
      el.scrollTop = top;
      el.scrollLeft = left;
    }
    this.scrollSnapshots.delete(paneId);
  }

  cleanup(validIds: Set<string>) {
    for (const [id, el] of this.containers) {
      if (!validIds.has(id)) {
        el.remove();
        this.containers.delete(id);
        this.scrollSnapshots.delete(id);
      }
    }
  }
}

const RegistryContext = createContext<PaneContainerRegistry>(null!);

/**
 * Hook for LeafPane to get the stable container for its pane
 * and attach it to its content area.
 */
export function usePaneContainer(
  paneId: string,
  contentRef: React.RefObject<HTMLDivElement | null>,
) {
  const registry = useContext(RegistryContext);
  const container = registry.get(paneId);

  // Save scroll positions during the RENDER phase — before React commits
  // DOM changes. At this point the container is still attached to its
  // current (possibly soon-to-be-removed) parent, so scroll values are valid.
  // This is a read-only DOM access, safe during render.
  registry.saveScroll(paneId);

  // Move the stable container into the pane's content div.
  // appendChild moves an existing element — no clone, no unmount.
  // Runs before paint so there's no visual flash.
  useLayoutEffect(() => {
    const div = contentRef.current;
    if (div && container.parentElement !== div) {
      div.appendChild(container);
      registry.restoreScroll(paneId);
    }
  });
}

/**
 * Wraps the pane tree and renders all tab contents into stable containers.
 * Tab components are keyed by tab.id and portaled into persistent DOM elements,
 * so they survive pane tree restructuring without remounting.
 */
export function PanePortalProvider({
  layout,
  children,
}: {
  layout: PaneNode;
  children: React.ReactNode;
}) {
  const registryRef = useRef<PaneContainerRegistry>(null!);
  if (!registryRef.current) {
    registryRef.current = new PaneContainerRegistry();
  }
  const registry = registryRef.current;

  const allLeaves = findAllLeaves(layout);
  const leafIds = useMemo(() => new Set(allLeaves.map((l) => l.id)), [allLeaves]);

  // Remove containers for panes that no longer exist
  useEffect(() => {
    registry.cleanup(leafIds);
  }, [registry, leafIds]);

  return (
    <RegistryContext.Provider value={registry}>
      {children}
      {allLeaves.flatMap((leaf) => {
        const container = registry.get(leaf.id);
        const activeTabId = leaf.activeTabId ?? leaf.tabs[0]?.id;
        // Sort by tab.id for stable DOM order — prevents React from
        // physically reordering portal children, which would break
        // Monaco editor instances (they don't survive DOM moves).
        return [...leaf.tabs]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((tab) =>
            createPortal(
              <div key={tab.id} className={tab.id === activeTabId ? "h-full" : "hidden"}>
                <TabContent tab={tab} paneId={leaf.id} />
              </div>,
              container,
              tab.id,
            ),
          );
      })}
    </RegistryContext.Provider>
  );
}
