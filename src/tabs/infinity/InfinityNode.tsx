import { NodeResizer, type NodeProps } from "@xyflow/react";
import type { InfinityNode as InfinityNodeType } from "../../store/infinity.store";
import { useInfinityStore } from "../../store/infinity.store";
import { getTabDefinition } from "../registry";
import { TabIcon } from "../../components/shared/TabIcon";

export function InfinityNode({ id, data }: NodeProps<InfinityNodeType>) {
  const removeNode = useInfinityStore((s) => s.removeNode);
  const definition = getTabDefinition(data.tabType);
  if (!definition) return null;

  const Component = definition.component;
  const pseudoTab = {
    id: `infinity-${id}`,
    type: data.tabType,
    title: data.title,
    icon: data.icon,
  };

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
      <div className="flex flex-col h-full w-full bg-[var(--color-bg-base)] border border-[var(--color-border-primary)] shadow-lg">
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

        {/* Content — nodrag to prevent drag; ctrl+scroll passes through for zoom */}
        <div
          className="flex-1 overflow-hidden nodrag"
          onWheel={(e) => {
            if (!e.ctrlKey) e.stopPropagation();
          }}
        >
          <Component tab={pseudoTab} paneId={`infinity-${id}`} />
        </div>
      </div>
    </>
  );
}
