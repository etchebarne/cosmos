import type { TabDefinition } from "../types";
import { BlankTab } from "./BlankTab";

export const blankTab: TabDefinition = {
  type: "blank",
  title: "Blank",
  icon: "file",
  component: BlankTab,
};
