import { GitBranch } from "lucide-react";

export function StatusBar() {
  return (
    <div className="flex items-center gap-3 h-6 min-h-6 px-3 bg-[var(--color-accent-blue)] text-white text-[11px]">
      <div className="flex items-center gap-1">
        <GitBranch size={12} />
        <span>main</span>
      </div>
      <div className="flex-1" />
      <span className="text-white/80">Ready</span>
    </div>
  );
}
