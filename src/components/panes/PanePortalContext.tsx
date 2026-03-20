import { createContext, useContext, useRef, useEffect, useLayoutEffect, useMemo } from "react";
import { createPortal } from "react-dom";
import { findAllLeaves } from "../../lib/pane-tree";
import { TabContent } from "./TabContent";
import type { PaneNode, Tab } from "../../types";

/**
 * Manages stable DOM containers for each tab.
 * Each tab gets a persistent <div> that follows it across pane moves.
 * Portal content renders into these stable divs, so React never unmounts
 * the tab components — even when a tab is dragged to a different pane.
 */
class PaneContainerRegistry {
  private tabContainers = new Map<string, HTMLDivElement>();
  private scrollSnapshots = new Map<string, { el: Element; top: number; left: number }[]>();

  getTab(tabId: string): HTMLDivElement {
    let el = this.tabContainers.get(tabId);
    if (!el) {
      el = document.createElement("div");
      el.style.height = "100%";
      this.tabContainers.set(tabId, el);
    }
    return el;
  }

  /** Capture scroll positions while the container is still in the live DOM. */
  saveScroll(tabId: string) {
    const container = this.tabContainers.get(tabId);
    if (!container || !container.isConnected) return;
    const saved: { el: Element; top: number; left: number }[] = [];
    container.querySelectorAll("*").forEach((el) => {
      if (el.scrollTop || el.scrollLeft) {
        saved.push({ el, top: el.scrollTop, left: el.scrollLeft });
      }
    });
    this.scrollSnapshots.set(tabId, saved);
  }

  /** Restore previously captured scroll positions. */
  restoreScroll(tabId: string) {
    const saved = this.scrollSnapshots.get(tabId);
    if (!saved) return;
    for (const { el, top, left } of saved) {
      el.scrollTop = top;
      el.scrollLeft = left;
    }
    this.scrollSnapshots.delete(tabId);
  }

  cleanup(validIds: Set<string>) {
    for (const [id, el] of this.tabContainers) {
      if (!validIds.has(id)) {
        el.remove();
        this.tabContainers.delete(id);
        this.scrollSnapshots.delete(id);
      }
    }
  }
}

const RegistryContext = createContext<PaneContainerRegistry>(null!);

/**
 * Hook for LeafPane to adopt the stable tab containers for its tabs
 * and attach them to its content area.
 */
export function usePaneContainer(
  _paneId: string,
  tabs: Tab[],
  activeTabId: string | null | undefined,
  contentRef: React.RefObject<HTMLDivElement | null>,
) {
  const registry = useContext(RegistryContext);

  // Save scroll positions during the RENDER phase — before React commits
  // DOM changes. At this point the containers are still attached to their
  // current (possibly soon-to-be-removed) parent, so scroll values are valid.
  // This is a read-only DOM access, safe during render.
  for (const tab of tabs) {
    registry.saveScroll(tab.id);
  }

  // Move the stable tab containers into the pane's content div.
  // appendChild moves an existing element — no clone, no unmount.
  // Runs before paint so there's no visual flash.
  useLayoutEffect(() => {
    const div = contentRef.current;
    if (!div) return;

    const resolvedActiveId = activeTabId ?? tabs[0]?.id;

    for (const tab of tabs) {
      const tabContainer = registry.getTab(tab.id);

      // Move the tab container into this pane if it isn't already here.
      // appendChild moves (not clones), so the container automatically
      // leaves its previous parent pane.
      if (tabContainer.parentElement !== div) {
        div.appendChild(tabContainer);
        // Notify tab content (e.g. xterm terminals) that their DOM
        // ancestor changed so they can refresh canvas rendering.
        tabContainer.dispatchEvent(new Event("pane-changed", { bubbles: true }));
      }

      // Set visibility based on whether this tab is active
      if (tab.id === resolvedActiveId) {
        tabContainer.className = "h-full";
        tabContainer.removeAttribute("inert");
      } else {
        tabContainer.className =
          "opacity-0 absolute inset-0 overflow-hidden pointer-events-none";
        tabContainer.setAttribute("inert", "");
      }
    }

    // Restore scroll positions after the containers have been placed
    for (const tab of tabs) {
      registry.restoreScroll(tab.id);
    }
  });
}

/**
 * Wraps the pane tree and renders all tab contents into stable containers.
 * Tab components are keyed by tab.id and portaled into persistent DOM elements,
 * so they survive pane moves without remounting.
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

  // Collect all valid tab IDs for cleanup
  const allTabIds = useMemo(
    () => new Set(allLeaves.flatMap((l) => l.tabs.map((t) => t.id))),
    [allLeaves],
  );

  // Remove containers for tabs that no longer exist
  useEffect(() => {
    registry.cleanup(allTabIds);
  }, [registry, allTabIds]);

  return (
    <RegistryContext.Provider value={registry}>
      {children}
      {allLeaves.flatMap((leaf) =>
        // Sort by tab.id for stable React reconciliation order
        [...leaf.tabs]
          .sort((a, b) => a.id.localeCompare(b.id))
          .map((tab) =>
            createPortal(
              <TabContent tab={tab} paneId={leaf.id} />,
              registry.getTab(tab.id),
              tab.id,
            ),
          ),
      )}
    </RegistryContext.Provider>
  );
}
