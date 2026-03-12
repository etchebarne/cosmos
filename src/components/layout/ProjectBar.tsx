import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon, Add01Icon } from "@hugeicons/core-free-icons";
import { open } from "@tauri-apps/plugin-dialog";
import { useWorkspaceStore } from "../../workspace-store";

export function ProjectBar() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeIndex = useWorkspaceStore((s) => s.activeIndex);
  const openWorkspace = useWorkspaceStore((s) => s.openWorkspace);
  const switchWorkspace = useWorkspaceStore((s) => s.switchWorkspace);

  const active = activeIndex !== null ? workspaces[activeIndex] : null;

  const handleOpenFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      await openWorkspace(selected);
    }
  };

  return (
    <div className="flex items-center gap-2 h-[52px] min-h-[52px] px-3 bg-[var(--color-project-bar-bg)] border-b border-[var(--color-border-primary)]">
      {active && (
        <span className="text-xs font-medium text-[var(--color-text-secondary)]">
          {active.name}
        </span>
      )}
      <div className="flex-1" />
      <div className="flex items-center gap-1.5 w-[220px] h-8 px-2.5 bg-[var(--color-bg-input)]">
        <HugeiconsIcon icon={Search01Icon} size={13} className="text-[var(--color-text-muted)] shrink-0" />
        <span className="text-xs text-[var(--color-text-muted)]">Search files...</span>
        <div className="flex-1" />
      </div>
      {workspaces.map((w, i) => {
        const isActive = i === activeIndex;
        return (
          <button
            key={w.path}
            title={w.path}
            className="font-mono w-8 h-8 flex items-center justify-center text-[13px] font-bold shrink-0 hover:opacity-85"
            style={{
              backgroundColor: isActive ? w.color : `${w.color}40`,
              color: isActive ? "#fff" : w.color,
            }}
            onClick={() => switchWorkspace(i)}
          >
            {w.name[0].toUpperCase()}
          </button>
        );
      })}
      <button
        className="w-8 h-8 flex items-center justify-center border border-[var(--color-border-secondary)] text-[var(--color-text-muted)] shrink-0 hover:border-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
        onClick={handleOpenFolder}
      >
        <HugeiconsIcon icon={Add01Icon} size={14} />
      </button>
    </div>
  );
}
