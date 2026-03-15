import type { TabDefinition } from "../types";
import { SettingsTab } from "./SettingsTab";

export const settingsTab: TabDefinition = {
  type: "settings",
  title: "Settings",
  icon: "settings",
  component: SettingsTab,
};
