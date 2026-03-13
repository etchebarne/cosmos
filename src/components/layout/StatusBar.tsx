import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HugeiconsIcon } from "@hugeicons/react";
import { GitBranchIcon } from "@hugeicons/core-free-icons";
import { useWorkspaceStore } from "../../workspace-store";

export function StatusBar() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeIndex = useWorkspaceStore((s) => s.activeIndex);
  const activePath = activeIndex !== null ? (workspaces[activeIndex]?.path ?? null) : null;

  const [branch, setBranch] = useState<string | null>(null);

  useEffect(() => {
    if (!activePath) {
      setBranch(null);
      return;
    }

    let cancelled = false;

    async function fetchBranch() {
      try {
        const result = await invoke<string | null>("get_git_branch", {
          path: activePath,
        });
        if (!cancelled) setBranch(result);
      } catch {
        if (!cancelled) setBranch(null);
      }
    }

    fetchBranch();
    const interval = setInterval(fetchBranch, 5000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [activePath]);

  return (
    <div className="flex items-center gap-3 h-6 min-h-6 px-3 bg-[var(--color-accent-blue)] text-white text-[11px]">
      <div className="flex items-center gap-1">
        <HugeiconsIcon icon={GitBranchIcon} size={12} />
        <span>{branch ?? "Not a git repo"}</span>
      </div>
      <div className="flex-1" />
      <span className="text-white/80">Ready</span>
    </div>
  );
}
