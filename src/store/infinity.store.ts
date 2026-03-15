import { create } from "zustand";
import {
  applyNodeChanges,
  type Node,
  type NodeChange,
  type ReactFlowInstance,
} from "@xyflow/react";
import { genId } from "../lib/pane-tree";
import { getTabDefinition } from "../tabs/registry";

export interface InfinityNodeData {
  tabType: string;
  title: string;
  icon: string;
  tabId: string;
  metadata?: Record<string, unknown>;
  [key: string]: unknown;
}

export type InfinityNode = Node<InfinityNodeData, "infinity-node">;

const EMPTY_NODES: InfinityNode[] = [];

interface InfinityStore {
  canvases: Record<string, InfinityNode[]>;
  instances: Record<string, ReactFlowInstance>;

  getNodes: (tabId: string) => InfinityNode[];
  addNode: (
    tabId: string,
    type: string,
    position: { x: number; y: number },
    title?: string,
    metadata?: Record<string, unknown>,
  ) => void;
  removeNode: (tabId: string, nodeId: string) => void;
  onNodesChange: (tabId: string, changes: NodeChange<InfinityNode>[]) => void;
  setInstance: (tabId: string, instance: ReactFlowInstance | null) => void;
}

export const useInfinityStore = create<InfinityStore>((set, get) => ({
  canvases: {},
  instances: {},

  getNodes: (tabId) => get().canvases[tabId] ?? EMPTY_NODES,

  addNode: (tabId, type, position, title, metadata) =>
    set((state) => {
      const def = getTabDefinition(type);
      if (!def) return state;

      const node: InfinityNode = {
        id: genId(),
        type: "infinity-node",
        position,
        data: {
          tabType: type,
          title: title ?? def.title,
          icon: def.icon,
          tabId,
          ...(metadata && { metadata }),
        },
        dragHandle: ".infinity-node-handle",
        style: { width: 400, height: 300 },
      };

      const nodes = state.canvases[tabId] ?? EMPTY_NODES;
      return {
        canvases: {
          ...state.canvases,
          [tabId]: [...nodes, node],
        },
      };
    }),

  removeNode: (tabId, nodeId) =>
    set((state) => {
      const nodes = state.canvases[tabId];
      if (!nodes) return state;
      return {
        canvases: {
          ...state.canvases,
          [tabId]: nodes.filter((n) => n.id !== nodeId),
        },
      };
    }),

  onNodesChange: (tabId, changes) =>
    set((state) => {
      const nodes = state.canvases[tabId] ?? EMPTY_NODES;
      return {
        canvases: {
          ...state.canvases,
          [tabId]: applyNodeChanges(changes, nodes),
        },
      };
    }),

  setInstance: (tabId, instance) =>
    set((state) => {
      const instances = { ...state.instances };
      if (instance) {
        instances[tabId] = instance;
      } else {
        delete instances[tabId];
      }
      return { instances };
    }),
}));
