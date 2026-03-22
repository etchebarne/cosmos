import type { TabDefinition } from "../types";
import { SearchTab } from "./SearchTab";

export const searchTab: TabDefinition = {
  type: "search",
  title: "Search",
  icon: "magnifying-glass",
  component: SearchTab,
  defaultSize: { width: 400, height: 500 },
};
