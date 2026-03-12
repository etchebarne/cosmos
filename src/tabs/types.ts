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
}
