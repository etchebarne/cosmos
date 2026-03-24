import type { TabDefinition } from "../types";
import { MarketplaceTab } from "./MarketplaceTab";

export const marketplaceTab: TabDefinition = {
  type: "marketplace",
  title: "Extensions",
  icon: "puzzle-piece",
  component: MarketplaceTab,
};
