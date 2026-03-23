import { create } from "zustand";

let nextId = 0;

export interface Toast {
  id: string;
  message: string;
  type: "info" | "warning" | "error" | "success";
  action?: {
    label: string;
    onClick: () => void;
  };
  duration: number;
}

interface ToastStore {
  toasts: Toast[];
  addToast: (toast: Omit<Toast, "id" | "duration"> & { duration?: number }) => string;
  removeToast: (id: string) => void;
}

export const useToastStore = create<ToastStore>((set) => ({
  toasts: [],

  addToast: (toast) => {
    const id = String(++nextId);
    const entry: Toast = { ...toast, id, duration: toast.duration ?? 8000 };
    set((s) => ({ toasts: [...s.toasts, entry] }));
    return id;
  },

  removeToast: (id) => {
    set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) }));
  },
}));
