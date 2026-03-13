import type { TabDefinition } from "../types";
import { EditorTab } from "./EditorTab";

export const editorTab: TabDefinition = {
  type: "editor",
  title: "Editor",
  icon: "code",
  component: EditorTab,
  hidden: true,
};
