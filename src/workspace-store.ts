import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";

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

export interface Workspace {
  path: string;
  name: string;
  color: string;
}

interface WorkspaceStore {
  workspaces: Workspace[];
  activeIndex: number | null;
  ready: boolean;

  init: () => Promise<void>;
  openWorkspace: (path: string) => Promise<void>;
  switchWorkspace: (index: number) => Promise<void>;
  closeWorkspace: (index: number) => Promise<void>;
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

  init: async () => {
    const s = await getStore();
    const workspaces = (await s.get<Workspace[]>("workspaces")) ?? [];
    const activeIndex = (await s.get<number>("activeIndex")) ?? null;
    set({ workspaces, activeIndex, ready: true });
  },

  openWorkspace: async (path: string) => {
    const state = get();
    const existing = state.workspaces.findIndex((w) => w.path === path);

    if (existing !== -1) {
      persist(state.workspaces, existing);
      set({ activeIndex: existing });
      return;
    }

    const color = WORKSPACE_COLORS[state.workspaces.length % WORKSPACE_COLORS.length];
    const workspace: Workspace = { path, name: nameFromPath(path), color };
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
    const workspaces = state.workspaces.filter((_, i) => i !== index);
    let activeIndex: number | null = state.activeIndex;

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
