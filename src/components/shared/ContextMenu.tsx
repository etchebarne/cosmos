import { useRef } from "react";
import { useClickOutside } from "../../hooks/use-click-outside";

export type ContextMenuItem =
  | { label: string; onClick: () => void; disabled?: boolean; destructive?: boolean }
  | { separator: true };

interface ContextMenuProps {
  x: number;
  y: number;
  items: ContextMenuItem[];
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onClose }: ContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useClickOutside(ref, onClose);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[140px] py-1 bg-[var(--color-bg-elevated)] border border-[var(--color-border-primary)] shadow-lg"
      style={{ left: x, top: y }}
    >
      {items.map((item, i) =>
        "separator" in item ? (
          <div key={`sep-${i}`} className="my-1 border-t border-[var(--color-border-primary)]" />
        ) : (
          <button
            key={item.label}
            className={`w-full text-left px-3 py-1.5 text-xs ${
              item.disabled
                ? "text-[var(--color-text-muted)] cursor-default"
                : item.destructive
                  ? "text-[var(--color-status-red)] hover:bg-[var(--color-bg-input)]"
                  : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-input)] hover:text-[var(--color-text-primary)]"
            }`}
            onClick={() => {
              if (item.disabled) return;
              item.onClick();
              onClose();
            }}
          >
            {item.label}
          </button>
        ),
      )}
    </div>
  );
}
