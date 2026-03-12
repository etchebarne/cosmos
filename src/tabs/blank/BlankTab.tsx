import type { TabContentProps } from "../types";

export function BlankTab({ tab }: TabContentProps) {
  return (
    <div className="font-mono flex items-center justify-center h-full text-[var(--color-text-tertiary)] text-[13px]">
      <span className="px-4 py-2 bg-[var(--color-bg-surface)] border border-[var(--color-border-primary)]">
        {tab.title}
      </span>
    </div>
  );
}
