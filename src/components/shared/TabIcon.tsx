import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import * as Icons from "@hugeicons/core-free-icons";

interface TabIconProps {
  name: string;
  size?: number;
  className?: string;
}

// Map tab icon keys to hugeicons exports
const iconMap: Record<string, IconSvgElement> = {
  file: Icons.File01Icon,
  "folder-tree": Icons.FolderTreeIcon,
};

export function TabIcon({ name, size = 14, className }: TabIconProps) {
  const icon = iconMap[name];
  if (!icon) return null;
  return <HugeiconsIcon icon={icon} size={size} className={className} />;
}
