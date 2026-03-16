import type { ComponentType } from "react";
import type { Tab } from "../types";

export interface TabContentProps {
  tab: Tab;
  paneId: string;
}

export interface TabDefinition {
  type: string;
  title: string;
  icon: string;
  component: ComponentType<TabContentProps>;
  hidden?: boolean;
  /** Default size when spawned on the infinity canvas */
  defaultSize?: { width: number; height: number };
}
