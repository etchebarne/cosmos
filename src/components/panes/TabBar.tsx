import { useRef, useCallback, useEffect } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Add01Icon, Cancel01Icon } from "@hugeicons/core-free-icons";
import { useLayoutStore } from "../../store/layout.store";
import { useDragStore } from "../../store/drag.store";
import { TabIcon } from "../shared/TabIcon";
import type { Tab } from "../../types";

interface TabBarProps {
  paneId: string;
  tabs: Tab[];
  activeTabId: string | null;
}

const DRAG_THRESHOLD = 5;

export function TabBar({ paneId, tabs, activeTabId }: TabBarProps) {
  const setActiveTab = useLayoutStore((s) => s.setActiveTab);
  const closeTab = useLayoutStore((s) => s.closeTab);
  const addTab = useLayoutStore((s) => s.addTab);
  const setDragState = useDragStore((s) => s.setDragState);
  const isDraggingRef = useRef(false);

  const handleTabMouseDown = useCallback(
    (e: React.MouseEvent, tab: Tab) => {
      if (e.button !== 0) return;

      const startX = e.clientX;
      const startY = e.clientY;
      isDraggingRef.current = false;

      const onMouseMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!isDraggingRef.current && Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
          isDraggingRef.current = true;
          setDragState({ tab, sourcePaneId: paneId });
        }
      };

      const onMouseUp = () => {
        if (!isDraggingRef.current) {
          setActiveTab(paneId, tab.id);
        }
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [paneId, setDragState, setActiveTab],
  );

  const tabBarRef = useRef<HTMLDivElement>(null);
  const prevTabCountRef = useRef(tabs.length);

  useEffect(() => {
    if (tabs.length > prevTabCountRef.current && tabBarRef.current) {
      tabBarRef.current.scrollLeft = tabBarRef.current.scrollWidth;
    }
    prevTabCountRef.current = tabs.length;
  }, [tabs.length]);

  const handleWheel = useCallback((e: React.WheelEvent) => {
    if (tabBarRef.current && e.deltaY !== 0) {
      e.preventDefault();
      tabBarRef.current.scrollLeft += e.deltaY;
    }
  }, []);

  return (
    <div
      ref={tabBarRef}
      className="flex items-center h-9 min-h-9 bg-[var(--color-project-bar-bg)] border-b border-[var(--color-border-primary)] overflow-x-auto overflow-y-hidden [&::-webkit-scrollbar]:h-0"
      data-tabbar-pane={paneId}
      onWheel={handleWheel}
    >
      {tabs.map((tab) => {
        const isActive = tab.id === activeTabId;
        return (
          <div
            key={tab.id}
            data-tab
            className={`group flex items-center gap-2 h-full px-3 cursor-grab select-none whitespace-nowrap ${
              isActive
                ? "bg-[var(--color-tab-active-bg)] border-b-2 border-[var(--color-accent-blue)]"
                : "bg-[var(--color-tab-inactive-bg)] border-b border-[var(--color-border-primary)] hover:bg-[var(--color-bg-surface)]"
            }`}
            onMouseDown={(e) => handleTabMouseDown(e, tab)}
          >
            <TabIcon
              name={tab.icon}
              size={14}
              className={`shrink-0 ${isActive ? "text-[var(--color-accent-blue)]" : "text-[var(--color-text-tertiary)]"}`}
            />
            <span
              className={`text-xs ${isActive ? "text-[var(--color-text-primary)]" : "text-[var(--color-text-secondary)]"}`}
            >
              {tab.title}
            </span>
            <button
              className="flex items-center justify-center p-0.5 text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity duration-100 hover:text-[var(--color-text-primary)] hover:bg-[var(--color-border-secondary)]"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => {
                e.stopPropagation();
                closeTab(paneId, tab.id);
              }}
            >
              <HugeiconsIcon icon={Cancel01Icon} size={12} />
            </button>
          </div>
        );
      })}
      <button
        className="flex items-center justify-center w-7 h-7 mx-1 text-[var(--color-text-muted)] shrink-0 hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-border-primary)]"
        onClick={() => addTab(paneId)}
      >
        <HugeiconsIcon icon={Add01Icon} size={14} />
      </button>
    </div>
  );
}
