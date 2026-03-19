import { memo } from "react";
import { getTabDefinition } from "../../tabs";
import { ErrorBoundary } from "../shared/ErrorBoundary";
import type { Tab } from "../../types";

interface TabContentProps {
  tab: Tab;
  paneId: string;
}

export const TabContent = memo(function TabContent({ tab, paneId }: TabContentProps) {
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
  return (
    <ErrorBoundary>
      <Component tab={tab} paneId={paneId} />
    </ErrorBoundary>
  );
});
