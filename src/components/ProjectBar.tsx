import { Search, Plus } from "lucide-react";

const PROJECT_ICONS = [
  { initial: "C", color: "#4B8EF5" },
  { initial: "S", color: "#7C5CED" },
  { initial: "A", color: "#10B981" },
  { initial: "D", color: "#E84757", bgOpacity: true },
];

export function ProjectBar() {
  return (
    <div className="flex items-center gap-2 h-[52px] min-h-[52px] px-3 bg-[var(--color-project-bar-bg)] border-b border-[var(--color-border-primary)]">
      <span className="text-xs font-medium text-[var(--color-text-secondary)]">cosmos-ui</span>
      <div className="flex-1" />
      <div className="flex items-center gap-1.5 w-[220px] h-8 px-2.5 bg-[var(--color-bg-input)]">
        <Search size={13} className="text-[var(--color-text-muted)] shrink-0" />
        <span className="text-xs text-[var(--color-text-muted)]">Search files...</span>
        <div className="flex-1" />
      </div>
      {PROJECT_ICONS.map((p) => (
        <button
          key={p.initial}
          className="font-mono w-8 h-8 flex items-center justify-center text-[13px] font-bold text-white shrink-0 hover:opacity-85"
          style={{
            backgroundColor: p.bgOpacity ? `${p.color}40` : p.color,
            color: p.bgOpacity ? p.color : "#fff",
          }}
        >
          {p.initial}
        </button>
      ))}
      <button className="w-8 h-8 flex items-center justify-center border border-[var(--color-border-secondary)] text-[var(--color-text-muted)] shrink-0 hover:border-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]">
        <Plus size={14} />
      </button>
    </div>
  );
}
