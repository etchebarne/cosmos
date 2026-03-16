import type { TabDefinition } from "../types";
import { GitTab } from "./GitTab";

export const gitTab: TabDefinition = {
  type: "git",
  title: "Git",
  icon: "git-branch",
  component: GitTab,
  defaultSize: { width: 400, height: 500 },
};
