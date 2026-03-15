import { create } from "zustand";
import { load, type Store } from "@tauri-apps/plugin-store";
import { applyTheme } from "../lib/themes";

interface SettingsStore {
  values: Record<string, unknown>;
  ready: boolean;

  init: () => Promise<void>;
  set: (key: string, value: unknown) => void;
  get: (key: string) => unknown;
}

let store: Store | null = null;

async function getStore() {
  if (!store) {
    store = await load("settings.json", { defaults: {}, autoSave: true });
  }
  return store;
}

async function persist(values: Record<string, unknown>) {
  const s = await getStore();
  await s.set("values", values);
}

function applySideEffects(key: string, value: unknown) {
  if (key === "theme.colorTheme") {
    applyTheme(String(value));
  }
}

export const useSettingsStore = create<SettingsStore>((set, get) => ({
  values: {},
  ready: false,

  init: async () => {
    const s = await getStore();
    const values = (await s.get<Record<string, unknown>>("values")) ?? {};
    set({ values, ready: true });

    // Apply all persisted settings
    for (const [key, value] of Object.entries(values)) {
      applySideEffects(key, value);
    }
  },

  set: (key: string, value: unknown) => {
    const next = { ...get().values, [key]: value };
    set({ values: next });
    persist(next);
    applySideEffects(key, value);
  },

  get: (key: string) => get().values[key],
}));
