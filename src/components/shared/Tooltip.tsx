import { useState, useRef, useCallback, useLayoutEffect } from "react";
import { createPortal } from "react-dom";

interface TooltipProps {
  content: React.ReactNode;
  children: React.ReactElement;
  delay?: number;
  side?: "top" | "bottom";
}

export function Tooltip({ content, children, delay = 400, side = "bottom" }: TooltipProps) {
  const [visible, setVisible] = useState(false);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const show = useCallback(() => {
    timeoutRef.current = setTimeout(() => setVisible(true), delay);
  }, [delay]);

  const hide = useCallback(() => {
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    setVisible(false);
  }, []);

  useLayoutEffect(() => {
    if (!visible || !triggerRef.current) return;
    const rect = triggerRef.current.getBoundingClientRect();
    setPosition({
      x: rect.left + rect.width / 2,
      y: side === "bottom" ? rect.bottom + 6 : rect.top - 6,
    });
  }, [visible, side]);

  return (
    <>
      <div ref={triggerRef} onMouseEnter={show} onMouseLeave={hide} className="inline-flex">
        {children}
      </div>
      {visible &&
        createPortal(
          <div
            className="fixed z-50 px-2 py-1 text-xs whitespace-nowrap bg-[var(--color-bg-elevated)] border border-[var(--color-border-primary)] text-[var(--color-text-primary)] shadow-lg pointer-events-none"
            style={{
              left: position.x,
              top: position.y,
              transform:
                side === "bottom" ? "translateX(-50%)" : "translateX(-50%) translateY(-100%)",
            }}
          >
            {content}
          </div>,
          document.body,
        )}
    </>
  );
}
