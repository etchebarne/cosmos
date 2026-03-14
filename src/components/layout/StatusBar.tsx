import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HugeiconsIcon } from "@hugeicons/react";
import { GitBranchIcon } from "@hugeicons/core-free-icons";
import { useWorkspaceStore } from "../../workspace-store";
import { useLspStore, resolveServerLanguage, type ServerStatus } from "../../lsp/lsp-store";
import { useLayoutStore } from "../../store";
import { findLeaf } from "../../lib/pane-tree";
import { Dialog } from "../shared/Dialog";

const STATUS_COLORS: Record<ServerStatus, string> = {
  running: "bg-emerald-400",
  starting: "bg-yellow-400",
  error: "bg-red-400",
  unavailable: "bg-orange-400",
  installing: "bg-blue-400",
  stopped: "bg-neutral-400",
};

const STATUS_LABELS: Record<ServerStatus, string> = {
  running: "",
  starting: "starting...",
  error: "error",
  unavailable: "not installed",
  installing: "installing...",
  stopped: "stopped",
};

/** Map file extension to the LSP server language group key. */
const EXT_TO_LANG: Record<string, string> = {
  ts: "typescript",
  tsx: "typescriptreact",
  js: "javascript",
  jsx: "javascriptreact",
  mts: "typescript",
  cts: "typescript",
  mjs: "javascript",
  cjs: "javascript",
  c: "c",
  h: "c",
  cpp: "cpp",
  hpp: "cpp",
  cc: "cpp",
  cxx: "cpp",
  css: "css",
  scss: "scss",
  less: "less",
  json: "json",
  jsonc: "jsonc",
  py: "python",
  rs: "rust",
  go: "go",
  lua: "lua",
  java: "java",
  html: "html",
  htm: "html",
  rb: "ruby",
  php: "php",
  swift: "swift",
  kt: "kotlin",
  toml: "toml",
  yaml: "yaml",
  yml: "yaml",
  md: "markdown",
  sh: "shellscript",
  bash: "shellscript",
};

function filePathToServerLang(filePath: string): string | null {
  const ext = filePath.match(/\.([^./\\]+)$/)?.[1]?.toLowerCase();
  if (!ext) return null;
  const langId = EXT_TO_LANG[ext];
  if (!langId) return null;
  return resolveServerLanguage(langId);
}

function LspStatusIndicators({ workspacePath }: { workspacePath: string }) {
  const servers = useLspStore((s) => s.servers[workspacePath]);
  const installServer = useLspStore((s) => s.installServer);
  const layout = useLayoutStore((s) => s.layout);
  const activePaneId = useLayoutStore((s) => s.activePaneId);
  const [installDialog, setInstallDialog] = useState<{
    serverName: string;
    languageId: string;
  } | null>(null);

  if (!servers) return null;

  // Find the focused editor's server language
  let focusedServerLang: string | null = null;
  if (activePaneId) {
    const leaf = findLeaf(layout, activePaneId);
    if (leaf?.activeTabId) {
      const activeTab = leaf.tabs.find((t) => t.id === leaf.activeTabId);
      if (activeTab?.type === "editor" && activeTab.metadata?.filePath) {
        focusedServerLang = filePathToServerLang(activeTab.metadata.filePath as string);
      }
    }
  }

  // Only show the focused editor's server
  const focusedServer = focusedServerLang ? servers[focusedServerLang] : null;
  if (!focusedServer || focusedServer.status === "stopped") return null;

  const allEntries = [focusedServer];

  const handleClick = (serverName: string, languageId: string, status: ServerStatus) => {
    if (status === "unavailable") {
      setInstallDialog({ serverName, languageId });
    }
  };

  const handleInstall = async () => {
    if (!installDialog) return;
    setInstallDialog(null);
    await installServer(workspacePath, installDialog.serverName);
  };

  return (
    <>
      {allEntries.map((server) => {
        const isClickable = server.status === "unavailable";
        return (
          <button
            key={server.languageId}
            className={`flex items-center gap-1.5 ${isClickable ? "cursor-pointer hover:text-white" : "cursor-default"}`}
            title={server.errorMessage ?? server.serverName}
            onClick={() => handleClick(server.serverName, server.languageId, server.status)}
          >
            <div
              className={`w-1.5 h-1.5 ${STATUS_COLORS[server.status]} ${server.status === "installing" ? "animate-pulse" : ""}`}
            />
            <span className="text-white/80">
              {server.serverName}
              {STATUS_LABELS[server.status] && (
                <span className="text-white/50"> ({STATUS_LABELS[server.status]})</span>
              )}
            </span>
          </button>
        );
      })}

      <Dialog
        open={installDialog !== null}
        onClose={() => setInstallDialog(null)}
        title={`Install ${installDialog?.serverName ?? ""}?`}
      >
        <div className="p-4 flex flex-col gap-4">
          <p className="text-xs text-[var(--color-text-secondary)]">
            <span className="text-[var(--color-text-primary)] font-medium">
              {installDialog?.serverName}
            </span>{" "}
            was not found on your system. Would you like to install it?
          </p>
          <div className="flex justify-end gap-2">
            <button
              className="px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer"
              onClick={() => setInstallDialog(null)}
            >
              Cancel
            </button>
            <button
              className="px-3 py-1.5 text-xs bg-[var(--color-accent-blue)] hover:bg-[var(--color-accent-blue-hover)] text-white transition-colors cursor-pointer"
              onClick={handleInstall}
            >
              Install
            </button>
          </div>
        </div>
      </Dialog>
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
