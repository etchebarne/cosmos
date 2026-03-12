import { useEffect, useRef } from "react";

export interface ContextMenuItem {
  label: string;
  onClick: () => void;
}

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handle = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        onClose();
      }
    };
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onClose]);

  useEffect(() => {
    const handle = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handle);
    return () => document.removeEventListener("keydown", handle);
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[140px] py-1 bg-[var(--color-bg-elevated)] border border-[var(--color-border-primary)] shadow-lg"
      style={{ left: x, top: y }}
    >
      {items.map((item) => (
        <button
          key={item.label}
          className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-input)] hover:text-[var(--color-text-primary)]"
          onClick={() => {
            item.onClick();
            onClose();
          }}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
