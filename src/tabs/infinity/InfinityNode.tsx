import { useEffect, useRef } from "react";
import { NodeResizer, type NodeProps } from "@xyflow/react";
import type { InfinityNode as InfinityNodeType } from "../../store/infinity.store";
import { useInfinityStore } from "../../store/infinity.store";
import { getTabDefinition } from "../registry";
import { TabIcon } from "../../components/shared/TabIcon";

export function InfinityNode({ id, data }: NodeProps<InfinityNodeType>) {
  const removeNode = useInfinityStore((s) => s.removeNode);
  const contentRef = useRef<HTMLDivElement>(null);
  const definition = getTabDefinition(data.tabType);
  if (!definition) return null;

  const Component = definition.component;
  const pseudoTab = {
    id: `infinity-${id}`,
    type: data.tabType,
    title: data.title,
    icon: data.icon,
    ...(data.metadata && { metadata: data.metadata }),
  };

  // Native wheel listeners (React synthetic stopPropagation doesn't block d3-zoom).
  // Capture phase: intercept ctrl+wheel before children (e.g. xterm) consume it,
  // then re-dispatch from the parent so it still bubbles up to ReactFlow for zoom.
  // Bubble phase: stop normal wheel from reaching ReactFlow so inner ScrollAreas scroll.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    const el = contentRef.current;
    if (!el) return;
    const captureHandler = (e: WheelEvent) => {
      if (e.ctrlKey) {
        e.stopPropagation();
        el.parentElement?.dispatchEvent(new WheelEvent(e.type, e));
      }
    };
    const bubbleHandler = (e: WheelEvent) => {
      if (!e.ctrlKey) e.stopPropagation();
    };
    el.addEventListener("wheel", captureHandler, { capture: true });
    el.addEventListener("wheel", bubbleHandler, { passive: true });
    return () => {
      el.removeEventListener("wheel", captureHandler, { capture: true });
      el.removeEventListener("wheel", bubbleHandler);
    };
  }, []);

  return (
    <>
      <NodeResizer
        minWidth={200}
        minHeight={150}
        handleStyle={{
          width: 8,
          height: 8,
          borderRadius: 0,
          backgroundColor: "var(--color-accent-blue)",
          border: "none",
        }}
        lineStyle={{
          borderColor: "var(--color-accent-blue)",
          borderWidth: 1,
        }}
      />
      <div className="flex flex-col h-full w-full bg-[var(--color-bg-page)] border border-[var(--color-border-primary)] shadow-lg">
        {/* Title bar — drag handle */}
        <div className="infinity-node-handle flex items-center gap-2 px-2 h-7 shrink-0 bg-[var(--color-bg-surface)] border-b border-[var(--color-border-secondary)] cursor-grab select-none">
          <TabIcon
            name={data.icon}
            size={12}
            className="shrink-0 text-[var(--color-text-tertiary)]"
          />
          <span className="text-[11px] text-[var(--color-text-secondary)] truncate flex-1">
            {data.title}
          </span>
          <button
            className="flex items-center justify-center w-4 h-4 hover:bg-[var(--color-bg-hover)] text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]"
            onClick={() => removeNode(data.tabId, id)}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <svg
              width="8"
              height="8"
              viewBox="0 0 8 8"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
            >
              <path d="M1 1L7 7M7 1L1 7" />
            </svg>
          </button>
        </div>

        {/* Content — nodrag to prevent drag */}
        <div ref={contentRef} className="flex-1 overflow-hidden nodrag">
          <Component tab={pseudoTab} paneId={`infinity-${id}`} />
        </div>
      </div>
    </>
  );
}
