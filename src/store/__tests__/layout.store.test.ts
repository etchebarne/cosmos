import { describe, it, expect, beforeEach, vi } from "vitest";

// Mock the tabs module to register basic tab definitions without React components
vi.mock("../../tabs", () => {
  const registry = new Map<string, { type: string; title: string; icon: string }>();
  registry.set("blank", { type: "blank", title: "Blank", icon: "file" });
  registry.set("editor", { type: "editor", title: "Editor", icon: "code" });
  registry.set("terminal", { type: "terminal", title: "Terminal", icon: "terminal" });

  return {
    registerTab: (def: { type: string }) => registry.set(def.type, def as never),
    getTabDefinition: (type: string) => registry.get(type),
    getAllTabDefinitions: () => Array.from(registry.values()),
    getVisibleTabDefinitions: () => Array.from(registry.values()),
  };
});

import { useLayoutStore } from "../layout.store";

describe("layout store", () => {
  beforeEach(() => {
    // Reset the store to a fresh default state before each test
    const fresh = useLayoutStore.getInitialState();
    useLayoutStore.setState(fresh, true);
  });

  it("starts with a single leaf containing one blank tab", () => {
    const { layout } = useLayoutStore.getState();
    expect(layout.type).toBe("leaf");
    if (layout.type === "leaf") {
      expect(layout.tabs).toHaveLength(1);
      expect(layout.tabs[0].type).toBe("blank");
    }
  });

  it("addTab adds a tab to the specified pane", () => {
    const { layout } = useLayoutStore.getState();
    const paneId = layout.id;

    useLayoutStore.getState().addTab(paneId, "editor", "main.ts");

    const updated = useLayoutStore.getState().layout;
    if (updated.type === "leaf") {
      expect(updated.tabs).toHaveLength(2);
      expect(updated.tabs[1].type).toBe("editor");
      expect(updated.tabs[1].title).toBe("main.ts");
      // addTab sets the new tab as active
      expect(updated.activeTabId).toBe(updated.tabs[1].id);
    }
  });

  it("closeTab removes a tab from the pane", () => {
    const { layout } = useLayoutStore.getState();
    const paneId = layout.id;

    // Add a second tab so we can close one without emptying the pane
    useLayoutStore.getState().addTab(paneId, "editor", "file.ts");

    const afterAdd = useLayoutStore.getState().layout;
    expect(afterAdd.type).toBe("leaf");
    if (afterAdd.type !== "leaf") return;
    expect(afterAdd.tabs).toHaveLength(2);

    const tabToClose = afterAdd.tabs[0].id;
    useLayoutStore.getState().closeTab(paneId, tabToClose);

    const afterClose = useLayoutStore.getState().layout;
    if (afterClose.type === "leaf") {
      expect(afterClose.tabs).toHaveLength(1);
      expect(afterClose.tabs[0].type).toBe("editor");
    }
  });

  it("setActiveTab sets the active tab for a pane", () => {
    const { layout } = useLayoutStore.getState();
    const paneId = layout.id;

    useLayoutStore.getState().addTab(paneId, "editor", "file.ts");

    const afterAdd = useLayoutStore.getState().layout;
    if (afterAdd.type !== "leaf") return;

    const firstTabId = afterAdd.tabs[0].id;
    const secondTabId = afterAdd.tabs[1].id;

    // The second tab should be active after addTab
    expect(afterAdd.activeTabId).toBe(secondTabId);

    // Switch back to the first tab
    useLayoutStore.getState().setActiveTab(paneId, firstTabId);

    const afterSet = useLayoutStore.getState().layout;
    if (afterSet.type === "leaf") {
      expect(afterSet.activeTabId).toBe(firstTabId);
    }
  });

  it("closeTab on the last tab replaces the pane with a new empty leaf", () => {
    const { layout } = useLayoutStore.getState();
    expect(layout.type).toBe("leaf");
    if (layout.type !== "leaf") return;

    const paneId = layout.id;
    const tabId = layout.tabs[0].id;

    useLayoutStore.getState().closeTab(paneId, tabId);

    const afterClose = useLayoutStore.getState().layout;
    // Should be a new leaf with a fresh blank tab (createLeaf default)
    expect(afterClose.type).toBe("leaf");
    if (afterClose.type === "leaf") {
      expect(afterClose.tabs).toHaveLength(1);
      expect(afterClose.tabs[0].type).toBe("blank");
      // It should be a new pane, not the same one
      expect(afterClose.id).not.toBe(paneId);
    }
  });
});
