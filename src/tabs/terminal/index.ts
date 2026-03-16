import type { TabDefinition } from "../types";
import { TerminalTab } from "./TerminalTab";

export const terminalTab: TabDefinition = {
  type: "terminal",
  title: "Terminal",
  icon: "terminal",
  component: TerminalTab,
  defaultSize: { width: 640, height: 360 },
};
