import { HugeiconsIcon } from "@hugeicons/react";
import { Folder02Icon, Folder01Icon, GitBranchIcon } from "@hugeicons/core-free-icons";
import { open } from "@tauri-apps/plugin-dialog";
import { useWorkspaceStore } from "../../workspace-store";

export function EmptyState() {
  const openWorkspace = useWorkspaceStore((s) => s.openWorkspace);

  const handleOpenFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      await openWorkspace(selected);
    }
  };

  return (
    <div className="flex flex-col items-center justify-center h-full w-full gap-4">
      <HugeiconsIcon icon={Folder02Icon} size={40} className="text-[var(--color-text-muted)]" />
      <div className="flex flex-col items-center justify-center gap-2">
        <h3 className="text-base font-semibold text-[var(--color-text-primary)]">
          No Workspace Open
        </h3>
        <p className="text-xs text-[var(--color-text-secondary)] text-center leading-relaxed w-[280px]">
          Open a folder or clone a repository to get started.
        </p>
      </div>
      <div className="flex gap-2.5">
        <button
          className="flex items-center gap-1.5 h-8 px-3.5 bg-[var(--color-accent-blue)] text-white text-xs font-medium hover:bg-[var(--color-accent-blue-hover)]"
          onClick={handleOpenFolder}
        >
          <HugeiconsIcon icon={Folder01Icon} size={13} />
          <span>Open Folder</span>
        </button>
        <button className="flex items-center gap-1.5 h-8 px-3.5 bg-[var(--color-bg-surface)] text-[var(--color-text-secondary)] text-xs font-medium border border-[var(--color-border-secondary)] hover:border-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)]">
          <HugeiconsIcon icon={GitBranchIcon} size={13} />
          <span>Clone Repo</span>
        </button>
      </div>
    </div>
  );
}
