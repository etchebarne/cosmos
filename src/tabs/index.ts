import { registerTab } from "./registry";
import { blankTab } from "./blank";

// Register all built-in tabs
registerTab(blankTab);

export { getTabDefinition, getAllTabDefinitions } from "./registry";
export { registerTab } from "./registry";
export type { TabDefinition, TabContentProps } from "./types";
export { blankTab } from "./blank";
