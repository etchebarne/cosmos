import { useCallback, useEffect, useState } from "react";
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  ReactFlowProvider,
  useReactFlow,
  type NodeChange,
} from "@xyflow/react";
import "@xyflow/react/dist/base.css";
import { useInfinityStore, type InfinityNode } from "../../store/infinity.store";
import { getVisibleTabDefinitions } from "../registry";
import { ContextMenu } from "../../components/shared/ContextMenu";
import { TabIcon } from "../../components/shared/TabIcon";
import { InfinityNode as InfinityNodeComponent } from "./InfinityNode";
import type { TabContentProps } from "../types";

const nodeTypes = { "infinity-node": InfinityNodeComponent };

function InfinityCanvas({ tab }: TabContentProps) {
  const nodes = useInfinityStore((s) => s.getNodes(tab.id));
  const addNode = useInfinityStore((s) => s.addNode);
  const onNodesChangeFn = useInfinityStore((s) => s.onNodesChange);
  const setInstance = useInfinityStore((s) => s.setInstance);
  const reactFlowInstance = useReactFlow();
  const { screenToFlowPosition } = reactFlowInstance;

  // Register instance so DragOverlay can convert screen coords for file drops
  useEffect(() => {
    setInstance(tab.id, reactFlowInstance);
    return () => setInstance(tab.id, null);
  }, [tab.id, reactFlowInstance, setInstance]);

  const [contextMenu, setContextMenu] = useState<{ x: number; y: number } | null>(null);

  const handleNodesChange = useCallback(
    (changes: NodeChange<InfinityNode>[]) => onNodesChangeFn(tab.id, changes),
    [tab.id, onNodesChangeFn],
  );

  const handleContextMenu = useCallback((e: React.MouseEvent | MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  }, []);

  const handlePaneClick = useCallback(() => setContextMenu(null), []);

  const definitions = getVisibleTabDefinitions().filter(
    (d) => d.type !== "blank" && d.type !== "infinity",
  );

  const contextMenuItems = definitions.map((def) => ({
    label: def.title,
    onClick: () => {
      if (contextMenu) {
        const position = screenToFlowPosition({ x: contextMenu.x, y: contextMenu.y });
        addNode(tab.id, def.type, position);
      }
    },
  }));

  return (
    <div className="h-full w-full relative font-ui" data-infinity-tab={tab.id}>
      <ReactFlow
        nodes={nodes}
        edges={[]}
        nodeTypes={nodeTypes}
        onNodesChange={handleNodesChange}
        onPaneContextMenu={handleContextMenu}
        onNodeContextMenu={handleContextMenu}
        onPaneClick={handlePaneClick}
        snapToGrid
        snapGrid={[20, 20]}
        panOnScroll
        zoomOnScroll={false}
        deleteKeyCode={null}
        elevateNodesOnSelect
        minZoom={0.1}
        maxZoom={3}
        fitView={false}
        proOptions={{ hideAttribution: true }}
      >
        <Background
          variant={BackgroundVariant.Dots}
          gap={20}
          size={1}
          color="var(--color-border-secondary)"
          bgColor="var(--color-bg-page)"
        />
      </ReactFlow>

      {/* Empty state */}
      {nodes.length === 0 && (
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none gap-3">
          <TabIcon
            name="infinity"
            size={32}
            className="text-[var(--color-text-muted)] opacity-40"
          />
          <p className="text-xs text-[var(--color-text-muted)]">
            Right-click to add tabs to the canvas
          </p>
        </div>
      )}

      {/* Context menu */}
      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}

export function InfinityTab(props: TabContentProps) {
  return (
    <ReactFlowProvider>
      <InfinityCanvas {...props} />
    </ReactFlowProvider>
  );
}
