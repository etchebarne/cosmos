import type { Icon } from "@phosphor-icons/react";
import {
  File,
  Code,
  TreeStructure,
  GitBranch,
  GitDiff,
  Terminal,
  GearSix,
  Infinity,
  MagnifyingGlass,
} from "@phosphor-icons/react";

interface TabIconProps {
  name: string;
  size?: number;
  className?: string;
}

// Map tab icon keys to phosphor icon components
const iconMap: Record<string, Icon> = {
  file: File,
  code: Code,
  "folder-tree": TreeStructure,
  "git-branch": GitBranch,
  "git-compare": GitDiff,
  terminal: Terminal,
  settings: GearSix,
  infinity: Infinity,
  "magnifying-glass": MagnifyingGlass,
};

export function TabIcon({ name, size = 14, className }: TabIconProps) {
  const IconComponent = iconMap[name];
  if (!IconComponent) return null;
  return <IconComponent size={size} className={className} />;
}
