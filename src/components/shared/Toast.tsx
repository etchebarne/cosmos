import { useEffect, useState, useRef } from "react";
import autoAnimate from "@formkit/auto-animate";
import { useToastStore, type Toast } from "../../store/toast.store";

const TYPE_STYLES: Record<Toast["type"], string> = {
  info: "border-l-[var(--color-accent-blue)]",
  warning: "border-l-orange-400",
  error: "border-l-[var(--color-status-red)]",
  success: "border-l-[var(--color-status-green)]",
};

function ToastItem({ toast }: { toast: Toast }) {
  const removeToast = useToastStore((s) => s.removeToast);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    // Trigger enter animation
    requestAnimationFrame(() => setVisible(true));

    if (toast.duration > 0) {
      const timer = setTimeout(() => {
        setVisible(false);
        setTimeout(() => removeToast(toast.id), 150);
      }, toast.duration);
      return () => clearTimeout(timer);
    }
  }, [toast.id, toast.duration, removeToast]);

  const dismiss = () => {
    setVisible(false);
    setTimeout(() => removeToast(toast.id), 150);
  };

  return (
    <div
      className={`flex items-center gap-3 px-3 py-2.5 bg-[var(--color-bg-surface)] border border-[var(--color-border-primary)] border-l-2 ${TYPE_STYLES[toast.type]} shadow-[3px_3px_0_rgba(0,0,0,0.25)] transition-all duration-150 ${visible ? "opacity-100 translate-x-0" : "opacity-0 translate-x-4"}`}
    >
      <span className="text-xs text-[var(--color-text-secondary)] flex-1">{toast.message}</span>
      {toast.action && (
        <button
          className="text-xs text-[var(--color-accent-blue)] hover:text-[var(--color-accent-blue-hover)] transition-colors cursor-pointer whitespace-nowrap"
          onClick={() => {
            toast.action!.onClick();
            dismiss();
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button
        className="text-xs text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer"
        onClick={dismiss}
      >
        &times;
      </button>
    </div>
  );
}

export function ToastContainer() {
  const toasts = useToastStore((s) => s.toasts);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (containerRef.current) {
      autoAnimate(containerRef.current, {
        duration: 150,
        easing: "cubic-bezier(0.16, 1, 0.3, 1)",
      });
    }
  }, []);

  if (toasts.length === 0) return null;

  return (
    <div ref={containerRef} className="fixed bottom-8 right-3 z-50 flex flex-col gap-2 max-w-sm">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} />
      ))}
    </div>
  );
}
