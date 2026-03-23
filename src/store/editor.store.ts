import { create } from "zustand";

export const DEFAULT_FONT_SIZE = 13;
export const MIN_FONT_SIZE = 8;
export const MAX_FONT_SIZE = 30;
const FONT_SIZE_STEP = 1;

interface EditorStore {
  editorFontSize: number;

  zoomEditorIn: () => void;
  zoomEditorOut: () => void;
  resetEditorZoom: () => void;
}

export const useEditorStore = create<EditorStore>((set) => ({
  editorFontSize: DEFAULT_FONT_SIZE,

  zoomEditorIn: () =>
    set((state) => ({
      editorFontSize: Math.min(state.editorFontSize + FONT_SIZE_STEP, MAX_FONT_SIZE),
    })),
  zoomEditorOut: () =>
    set((state) => ({
      editorFontSize: Math.max(state.editorFontSize - FONT_SIZE_STEP, MIN_FONT_SIZE),
    })),
  resetEditorZoom: () => set({ editorFontSize: DEFAULT_FONT_SIZE }),
}));
