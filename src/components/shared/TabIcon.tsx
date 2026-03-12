import * as Icons from "lucide-react";

interface TabIconProps {
  name: string;
  size?: number;
  className?: string;
}

export function TabIcon({ name, size = 14, className }: TabIconProps) {
  const iconName = name
    .split("-")
    .map((s) => s.charAt(0).toUpperCase() + s.slice(1))
    .join("") as keyof typeof Icons;
  const Icon = Icons[iconName] as React.ElementType | undefined;
  if (!Icon || typeof Icon !== "function") return null;
  return <Icon size={size} className={className} />;
}
