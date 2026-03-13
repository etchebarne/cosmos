import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HugeiconsIcon } from "@hugeicons/react";
import { GitBranchIcon } from "@hugeicons/core-free-icons";
import { useWorkspaceStore } from "../../workspace-store";
import { useLspStore, type ServerStatus } from "../../lsp/lsp-store";

const STATUS_COLORS: Record<ServerStatus, string> = {
  running: "bg-emerald-400",
  starting: "bg-yellow-400",
  error: "bg-red-400",
  unavailable: "bg-orange-400",
  stopped: "bg-neutral-400",
};

const STATUS_LABELS: Record<ServerStatus, string> = {
  running: "",
  starting: "starting...",
  error: "error",
  unavailable: "not installed",
  stopped: "stopped",
};

function LspStatusIndicators({ workspacePath }: { workspacePath: string }) {
  const servers = useLspStore((s) => s.servers[workspacePath]);

  if (!servers) return null;

  const entries = Object.values(servers).filter((s) => s.status !== "stopped");
  if (entries.length === 0) return null;

  return (
    <>
      {entries.map((server) => (
        <div
          key={server.languageId}
          className="flex items-center gap-1.5"
          title={server.errorMessage ?? server.serverName}
        >
          <div className={`w-1.5 h-1.5 ${STATUS_COLORS[server.status]}`} />
          <span className="text-white/80">
            {server.serverName}
            {STATUS_LABELS[server.status] && (
              <span className="text-white/50"> ({STATUS_LABELS[server.status]})</span>
            )}
          </span>
        </div>
      ))}
    </>
  );
}

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
      <div className="flex items-center gap-3">
        {activePath && <LspStatusIndicators workspacePath={activePath} />}
      </div>
    </div>
  );
}
