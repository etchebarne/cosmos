import { registerTab } from "./registry";
import { blankTab } from "./blank";
import { fileTreeTab } from "./file-tree";
import { gitTab } from "./git";
import { editorTab } from "./editor";

// Register all built-in tabs
registerTab(blankTab);
registerTab(fileTreeTab);
registerTab(gitTab);
registerTab(editorTab);

export { getTabDefinition, getAllTabDefinitions, getVisibleTabDefinitions } from "./registry";
export { registerTab } from "./registry";
export type { TabDefinition, TabContentProps } from "./types";
export { blankTab } from "./blank";
export { fileTreeTab } from "./file-tree";
export { gitTab } from "./git";
export { editorTab } from "./editor";
