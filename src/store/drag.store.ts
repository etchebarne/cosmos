import { create } from "zustand";
import type { DragState } from "../types";

interface DragStore {
  dragState: DragState | null;
  setDragState: (data: DragState | null) => void;
}

export const useDragStore = create<DragStore>((set) => ({
  dragState: null,
  setDragState: (data) => set({ dragState: data }),
}));
