import { File, Plus, LayoutTemplate } from "lucide-react";
import { useLayoutStore } from "../../store";
import { getTabDefinition } from "../../tabs";
import type { Tab } from "../../types";

interface TabContentProps {
  tab: Tab | null;
  paneId: string;
}

export function TabContent({ tab, paneId }: TabContentProps) {
  const addTab = useLayoutStore((s) => s.addTab);

  if (!tab) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <File size={40} className="text-[var(--color-text-muted)]" />
        <div className="flex flex-col items-center justify-center gap-2">
          <h3 className="text-base font-semibold text-[var(--color-text-primary)]">
            Get Started
          </h3>
          <p className="text-xs text-[var(--color-text-secondary)] text-center leading-relaxed w-[280px]">
            Open a new tab or start from a template.
          </p>
        </div>
        <div className="flex gap-2.5">
          <button
            className="flex items-center gap-1.5 h-8 px-3.5 bg-[var(--color-accent-blue)] text-white text-xs font-medium hover:bg-[var(--color-accent-blue-hover)]"
            onClick={() => addTab(paneId)}
          >
            <Plus size={13} />
            <span>Open Tab</span>
          </button>
          <button className="flex items-center gap-1.5 h-8 px-3.5 bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] text-xs font-medium border border-[var(--color-border-secondary)] hover:border-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">
            <LayoutTemplate size={13} />
            <span>Templates</span>
          </button>
        </div>
      </div>
    );
  }

  const definition = getTabDefinition(tab.type);

  if (!definition) {
    return (
      <div className="font-mono flex items-center justify-center h-full text-[var(--color-text-tertiary)] text-[13px]">
        <span className="px-4 py-2 bg-[var(--color-bg-surface)] border border-[var(--color-border-primary)]">
          Unknown tab type: {tab.type}
        </span>
      </div>
    );
  }

  const Component = definition.component;
  return <Component tab={tab} paneId={paneId} />;
}
