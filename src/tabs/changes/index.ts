import type { TabDefinition } from "../types";
import { ChangesTab } from "./ChangesTab";

export const changesTab: TabDefinition = {
  type: "changes",
  title: "Changes",
  icon: "git-compare",
  component: ChangesTab,
  hidden: true,
};
