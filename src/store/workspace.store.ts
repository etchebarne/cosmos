import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { load, type Store } from "@tauri-apps/plugin-store";
import { useLspStore } from "./lsp.store";

const WORKSPACE_COLORS = [
  "#4B8EF5",
  "#7C5CED",
  "#10B981",
  "#E84757",
  "#F59E0B",
  "#EC4899",
  "#06B6D4",
  "#8B5CF6",
];

export type ConnectionType =
  | { type: "local" }
  | { type: "wsl"; distro: string }
  | { type: "ssh"; host: string; user?: string };

export interface Workspace {
  path: string;
  name: string;
  color: string;
  connection: ConnectionType;
}

interface WorkspaceStore {
  workspaces: Workspace[];
  activeIndex: number | null;
  ready: boolean;
  /** Paths of remote workspaces that are still connecting. */
  connectingPaths: Set<string>;

  init: () => Promise<void>;
  openWorkspace: (path: string, connection?: ConnectionType) => Promise<void>;
  switchWorkspace: (index: number) => Promise<void>;
  closeWorkspace: (index: number) => Promise<void>;
  isConnecting: (path: string) => boolean;
}

function nameFromPath(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() ?? "workspace";
}

let store: Store | null = null;

async function getStore() {
  if (!store) {
    store = await load("workspace.json", { defaults: {}, autoSave: true });
  }
  return store;
}

async function persist(workspaces: Workspace[], activeIndex: number | null) {
  const s = await getStore();
  await s.set("workspaces", workspaces);
  await s.set("activeIndex", activeIndex);
}

export const useWorkspaceStore = create<WorkspaceStore>((set, get) => ({
  workspaces: [],
  activeIndex: null,
  ready: false,
  connectingPaths: new Set(),

  isConnecting: (path: string) => get().connectingPaths.has(path),

  init: async () => {
    const s = await getStore();
    const raw = (await s.get<Workspace[]>("workspaces")) ?? [];
    // Migrate workspaces saved before the connection field existed
    const workspaces = raw.map((w) => ({
      ...w,
      connection: w.connection ?? { type: "local" as const },
    }));
    const activeIndex = (await s.get<number>("activeIndex")) ?? null;
    // Collect remote workspace paths that need connecting
    const remotePaths = new Set(
      workspaces.filter((w) => w.connection.type !== "local").map((w) => w.path),
    );

    set({ workspaces, activeIndex, ready: true, connectingPaths: remotePaths });

    // Reconnect remote workspaces in the background
    for (const w of workspaces) {
      if (w.connection.type !== "local") {
        invoke("remote_ensure_connected", {
          workspacePath: w.path,
          connection: w.connection,
        })
          .catch((e) => {
            console.warn(`Failed to reconnect ${w.name}:`, e);
          })
          .finally(() => {
            const next = new Set(get().connectingPaths);
            next.delete(w.path);
            set({ connectingPaths: next });
          });
      }
    }
  },

  openWorkspace: async (path: string, connection: ConnectionType = { type: "local" }) => {
    const state = get();
    const existing = state.workspaces.findIndex((w) => w.path === path);

    if (existing !== -1) {
      persist(state.workspaces, existing);
      set({ activeIndex: existing });
      return;
    }

    const color = WORKSPACE_COLORS[state.workspaces.length % WORKSPACE_COLORS.length];
    const workspace: Workspace = { path, name: nameFromPath(path), color, connection };
    const workspaces = [...state.workspaces, workspace];
    const activeIndex = workspaces.length - 1;
    persist(workspaces, activeIndex);
    set({ workspaces, activeIndex });
  },

  switchWorkspace: async (index: number) => {
    const state = get();
    if (index < 0 || index >= state.workspaces.length) return;
    persist(state.workspaces, index);
    set({ activeIndex: index });
  },

  closeWorkspace: async (index: number) => {
    const state = get();
    const closedPath = state.workspaces[index]?.path;
    const workspaces = state.workspaces.filter((_, i) => i !== index);
    let activeIndex: number | null = state.activeIndex;

    // Stop LSP servers for the closed workspace
    if (closedPath) {
      useLspStore.getState().stopWorkspace(closedPath);
    }

    // Disconnect remote agent
    const closedWorkspace = state.workspaces[index];
    if (closedWorkspace?.connection?.type !== "local") {
      invoke("remote_disconnect", { workspacePath: closedPath }).catch(() => {});
    }

    if (workspaces.length === 0) {
      activeIndex = null;
    } else if (activeIndex !== null) {
      if (index === activeIndex) {
        activeIndex = Math.min(index, workspaces.length - 1);
      } else if (index < activeIndex) {
        activeIndex = activeIndex - 1;
      }
    }

    persist(workspaces, activeIndex);
    set({ workspaces, activeIndex });
  },
}));
