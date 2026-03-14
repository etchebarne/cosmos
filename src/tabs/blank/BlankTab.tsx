import { getVisibleTabDefinitions } from "../registry";
import { useLayoutStore } from "../../store/layout.store";
import { TabIcon } from "../../components/shared/TabIcon";
import type { TabContentProps } from "../types";

export function BlankTab({ tab, paneId }: TabContentProps) {
  const transformTab = useLayoutStore((s) => s.transformTab);
  const definitions = getVisibleTabDefinitions().filter((d) => d.type !== "blank");

  return (
    <div className="@container flex flex-col items-center justify-center h-full gap-6 p-4">
      <div className="flex flex-col items-center gap-2">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">New Tab</h3>
        <p className="text-xs text-[var(--color-text-secondary)]">
          Select a tab type to get started
        </p>
      </div>
      {definitions.length === 0 ? (
        <p className="text-xs text-[var(--color-text-muted)]">No tab types available</p>
      ) : (
        <div className="grid grid-cols-1 @[360px]:grid-cols-2 gap-2 w-full @[360px]:w-[320px]">
          {definitions.map((def) => (
            <button
              key={def.type}
              className="flex items-center gap-3 px-3 py-2.5 bg-[var(--color-bg-surface)] border border-[var(--color-border-secondary)] text-left hover:border-[var(--color-accent-blue)] hover:bg-[var(--color-bg-hover)] transition-colors"
              onClick={() => transformTab(paneId, tab.id, def.type)}
            >
              <TabIcon
                name={def.icon}
                size={16}
                className="shrink-0 text-[var(--color-text-tertiary)]"
              />
              <span className="text-xs text-[var(--color-text-primary)]">{def.title}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
