import { describe, it, expect, beforeEach } from "vitest";
import { useToastStore } from "../toast.store";

describe("toast store", () => {
  beforeEach(() => {
    useToastStore.setState({ toasts: [] });
  });

  it("addToast assigns ID and default duration", () => {
    const id = useToastStore.getState().addToast({ message: "hello", type: "info" });
    const toasts = useToastStore.getState().toasts;
    expect(toasts).toHaveLength(1);
    expect(toasts[0].id).toBe(id);
    expect(toasts[0].duration).toBe(8000);
    expect(toasts[0].message).toBe("hello");
  });

  it("addToast respects custom duration", () => {
    useToastStore.getState().addToast({ message: "test", type: "error", duration: 5000 });
    expect(useToastStore.getState().toasts[0].duration).toBe(5000);
  });

  it("removeToast removes by ID", () => {
    const id = useToastStore.getState().addToast({ message: "hello", type: "info" });
    useToastStore.getState().addToast({ message: "world", type: "success" });
    expect(useToastStore.getState().toasts).toHaveLength(2);
    useToastStore.getState().removeToast(id);
    expect(useToastStore.getState().toasts).toHaveLength(1);
    expect(useToastStore.getState().toasts[0].message).toBe("world");
  });
});
