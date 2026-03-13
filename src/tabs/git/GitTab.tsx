import { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  GitBranchIcon,
  ArrowDown01Icon,
  ArrowReloadHorizontalIcon,
  Tick02Icon,
  Loading03Icon,
} from "@hugeicons/core-free-icons";
import { useWorkspaceStore } from "../../workspace-store";
import { GitChangeNode } from "./GitChangeNode";
import { ScrollArea } from "../../components/shared/ScrollArea";
import { BranchPicker } from "./BranchPicker";
import type { TabContentProps } from "../types";

type GitAction = "fetch" | "pull" | "pull_rebase" | "push" | "force_push";

const GIT_ACTIONS: { key: GitAction; label: string; command: string }[] = [
  { key: "fetch", label: "Fetch", command: "git_fetch" },
  { key: "pull", label: "Pull", command: "git_pull" },
  { key: "pull_rebase", label: "Pull (Rebase)", command: "git_pull_rebase" },
  { key: "push", label: "Push", command: "git_push" },
  { key: "force_push", label: "Force Push", command: "git_force_push" },
];

export interface GitFileChange {
  path: string;
  status: string;
  staged: boolean;
  additions: number;
  deletions: number;
}

interface GitStatusInfo {
  changes: GitFileChange[];
  branch: string | null;
  remoteBranch: string | null;
  lastCommitMessage: string | null;
  hasRemote: boolean;
  isRepo: boolean;
}

export interface TreeNode {
  name: string;
  path: string;
  isDir: boolean;
  children: TreeNode[];
  change?: GitFileChange;
}

interface TrieNode {
  children: Map<string, TrieNode>;
  isFile: boolean;
  change?: GitFileChange;
}

function buildChangeTree(changes: GitFileChange[]): TreeNode[] {
  if (changes.length === 0) return [];

  const root = new Map<string, TrieNode>();

  for (const change of changes) {
    const parts = change.path.split("/");
    let current = root;

    for (let i = 0; i < parts.length; i++) {
      const part = parts[i];
      if (!current.has(part)) {
        current.set(part, {
          children: new Map(),
          isFile: i === parts.length - 1,
          change: i === parts.length - 1 ? change : undefined,
        });
      }
      current = current.get(part)!.children;
    }
  }

  function convert(map: Map<string, TrieNode>): TreeNode[] {
    const nodes: TreeNode[] = [];

    for (const [name, data] of map) {
      if (data.isFile) {
        nodes.push({
          name,
          path: data.change!.path,
          isDir: false,
          children: [],
          change: data.change,
        });
      } else {
        let collapsedName = name;
        let currentData = data;

        while (currentData.children.size === 1) {
          const entry = currentData.children.entries().next();
          if (entry.done) break;
          const [childName, childData] = entry.value;
          if (childData.isFile) break;
          collapsedName += "/" + childName;
          currentData = childData;
        }

        const children = convert(currentData.children);
        nodes.push({
          name: collapsedName,
          path: collapsedName,
          isDir: true,
          children,
        });
      }
    }

    nodes.sort((a, b) => {
      if (a.isDir && !b.isDir) return -1;
      if (!a.isDir && b.isDir) return 1;
      return a.name.localeCompare(b.name);
    });

    return nodes;
  }

  return convert(root);
}

function getNodeFiles(node: TreeNode): GitFileChange[] {
  if (!node.isDir && node.change) return [node.change];
  return node.children.flatMap(getNodeFiles);
}

export function GitTab({ tab: _tab, paneId: _paneId }: TabContentProps) {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeIndex = useWorkspaceStore((s) => s.activeIndex);
  const activeWorkspace =
    activeIndex !== null ? workspaces[activeIndex] : null;

  const [status, setStatus] = useState<GitStatusInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const [activeAction, setActiveAction] = useState<GitAction>("fetch");
  const [actionRunning, setActionRunning] = useState(false);
  const [actionDone, setActionDone] = useState(false);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const branchBarRef = useRef<HTMLDivElement>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);

  const currentAction = useMemo(
    () => GIT_ACTIONS.find((a) => a.key === activeAction)!,
    [activeAction],
  );

  const refresh = useCallback(async () => {
    if (!activeWorkspace) return;
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<GitStatusInfo>("get_git_status", {
        path: activeWorkspace.path,
      });
      setStatus(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [activeWorkspace]);

  useEffect(() => {
    refresh();
  }, [refresh]);

  // File system watcher: instant updates on any file or git change
  useEffect(() => {
    if (!activeWorkspace) return;

    invoke("watch_workspace", { path: activeWorkspace.path });

    const unlisten = listen("git-changed", () => {
      refresh();
    });

    return () => {
      unlisten.then((fn) => fn());
      invoke("unwatch_workspace");
    };
  }, [activeWorkspace, refresh]);

  const handleStageAll = useCallback(async () => {
    if (!activeWorkspace) return;
    try {
      await invoke("git_stage_all", { path: activeWorkspace.path });
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }, [activeWorkspace, refresh]);

  const handleUnstageAll = useCallback(async () => {
    if (!activeWorkspace || !status) return;
    try {
      const stagedFiles = status.changes
        .filter((c) => c.staged)
        .map((c) => c.path);
      if (stagedFiles.length > 0) {
        await invoke("git_unstage", {
          path: activeWorkspace.path,
          files: stagedFiles,
        });
        refresh();
      }
    } catch (e) {
      setError(String(e));
    }
  }, [activeWorkspace, status, refresh]);

  const handleToggleStage = useCallback(
    async (node: TreeNode) => {
      if (!activeWorkspace) return;
      const files = getNodeFiles(node).map((f) => f.path);
      const allStaged = getNodeFiles(node).every((f) => f.staged);
      try {
        if (allStaged) {
          await invoke("git_unstage", {
            path: activeWorkspace.path,
            files,
          });
        } else {
          await invoke("git_stage", { path: activeWorkspace.path, files });
        }
        refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [activeWorkspace, refresh],
  );

  const handleCommit = useCallback(async () => {
    if (!activeWorkspace || !commitMessage.trim()) return;
    setCommitting(true);
    try {
      await invoke("git_commit", {
        path: activeWorkspace.path,
        message: commitMessage,
      });
      setCommitMessage("");
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setCommitting(false);
    }
  }, [activeWorkspace, commitMessage, refresh]);

  const handleRunAction = useCallback(
    async (action?: GitAction) => {
      if (!activeWorkspace || actionRunning) return;
      const act = GIT_ACTIONS.find((a) => a.key === (action ?? activeAction))!;
      if (action) setActiveAction(action);
      setActionRunning(true);
      try {
        await invoke(act.command, { path: activeWorkspace.path });
        refresh();
        setActionDone(true);
        setTimeout(() => setActionDone(false), 2000);
      } catch (e) {
        setError(String(e));
      } finally {
        setActionRunning(false);
      }
    },
    [activeWorkspace, refresh, actionRunning, activeAction],
  );

  // Close action menu on outside click
  useEffect(() => {
    if (!showActionMenu) return;
    const handler = (e: MouseEvent) => {
      if (
        actionMenuRef.current &&
        !actionMenuRef.current.contains(e.target as Node)
      ) {
        setShowActionMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [showActionMenu]);

  const handleInit = useCallback(async () => {
    if (!activeWorkspace) return;
    try {
      await invoke("git_init", { path: activeWorkspace.path });
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }, [activeWorkspace, refresh]);

  if (!activeWorkspace) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-[var(--color-text-muted)]">
          No workspace open
        </p>
      </div>
    );
  }

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-[var(--color-text-secondary)]">
          Loading...
        </p>
      </div>
    );
  }

  if (error && !status) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-[var(--color-status-red)]">{error}</p>
      </div>
    );
  }

  if (status && !status.isRepo) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-3 font-ui">
        <p className="text-xs text-[var(--color-text-muted)]">
          This workspace is not a git repository
        </p>
        <button
          className="px-3 py-1.5 text-xs text-[var(--color-text-primary)] bg-[var(--color-bg-elevated)] border border-[var(--color-border-secondary)] hover:bg-[var(--color-bg-surface)] transition-colors cursor-pointer"
          onClick={handleInit}
        >
          Initialize Git
        </button>
      </div>
    );
  }

  const changes = status?.changes ?? [];
  const tracked = changes.filter((c) => c.status !== "untracked");
  const untracked = changes.filter((c) => c.status === "untracked");
  const trackedTree = buildChangeTree(tracked);
  const untrackedTree = buildChangeTree(untracked);
  const stagedCount = changes.filter((c) => c.staged).length;
  const allStaged = changes.length > 0 && stagedCount === changes.length;

  return (
    <div className="flex flex-col h-full font-ui">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--color-border-primary)]">
        <span className="text-xs text-[var(--color-text-primary)]">
          {changes.length === 0
            ? "No Changes"
            : `${changes.length} Change${changes.length !== 1 ? "s" : ""}`}
        </span>
        <div className="flex items-center gap-2">
          <button
            className="text-xs text-[var(--color-accent-blue)] hover:text-[var(--color-accent-blue-hover)] transition-colors cursor-pointer"
            onClick={allStaged ? handleUnstageAll : handleStageAll}
          >
            {allStaged ? "Unstage All" : "Stage All"}
          </button>
        </div>
      </div>

      {/* Changes tree */}
      <ScrollArea className="flex-1">
        {changes.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-[var(--color-text-muted)]">
              No changes
            </p>
          </div>
        ) : (
          <div className="pt-1 pb-4">
            {tracked.length > 0 && (
              <>
                <div className="px-3 py-1">
                  <span className="text-[11px] text-[var(--color-text-tertiary)] uppercase tracking-wider">
                    Tracked
                  </span>
                </div>
                {trackedTree.map((node) => (
                  <GitChangeNode
                    key={node.path}
                    node={node}
                    depth={0}
                    onToggleStage={handleToggleStage}
                  />
                ))}
              </>
            )}
            {untracked.length > 0 && (
              <>
                <div className="px-3 py-1 mt-2">
                  <span className="text-[11px] text-[var(--color-text-tertiary)] uppercase tracking-wider">
                    Untracked
                  </span>
                </div>
                {untrackedTree.map((node) => (
                  <GitChangeNode
                    key={node.path}
                    node={node}
                    depth={0}
                    onToggleStage={handleToggleStage}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </ScrollArea>

      {/* Bottom section */}
      <div className="border-t border-[var(--color-border-primary)]">
        {/* Branch bar */}
        <div
          ref={branchBarRef}
          className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--color-border-primary)]"
        >
          <button
            className="flex items-center gap-2 min-w-0 hover:bg-[var(--color-bg-elevated)] transition-colors cursor-pointer px-1 py-0.5 -mx-1"
            onClick={() => setShowBranchPicker((v) => !v)}
          >
            <HugeiconsIcon
              icon={GitBranchIcon}
              size={12}
              className="text-[var(--color-status-green)] shrink-0"
            />
            <span className="text-[11px] text-[var(--color-text-secondary)] truncate">
              {status?.remoteBranch
                ? status.remoteBranch.replace(/\//, " / ")
                : status?.branch ?? "\u2014"}
            </span>
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              size={10}
              className="text-[var(--color-text-tertiary)] shrink-0"
            />
          </button>
          <div className="flex-1" />
          <div className="relative flex items-center" ref={actionMenuRef}>
            <button
              className="flex items-center gap-1 px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => handleRunAction()}
              disabled={actionRunning || !status?.hasRemote}
            >
              <HugeiconsIcon
                icon={actionDone ? Tick02Icon : actionRunning ? Loading03Icon : ArrowReloadHorizontalIcon}
                size={12}
                className={`${actionDone ? "text-[var(--color-status-green)]" : ""} ${actionRunning ? "animate-spin" : ""}`}
              />
              {currentAction.label}
            </button>
            <button
              className="flex items-center px-1 py-0.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-elevated)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={() => setShowActionMenu((v) => !v)}
              disabled={!status?.hasRemote}
            >
              <HugeiconsIcon icon={ArrowDown01Icon} size={10} />
            </button>
            {showActionMenu && (
              <div className="absolute bottom-full right-0 mb-1 min-w-[140px] bg-[var(--color-bg-elevated)] border border-[var(--color-border-secondary)] shadow-lg z-50">
                {GIT_ACTIONS.map((action) => (
                  <button
                    key={action.key}
                    className={`w-full text-left px-3 py-1.5 text-[11px] transition-colors cursor-pointer ${
                      action.key === activeAction
                        ? "text-[var(--color-text-primary)] bg-[var(--color-bg-surface)]"
                        : "text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-surface)] hover:text-[var(--color-text-primary)]"
                    }`}
                    onClick={() => {
                      setShowActionMenu(false);
                      handleRunAction(action.key);
                    }}
                  >
                    {action.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
        {showBranchPicker && activeWorkspace && (
          <BranchPicker
            workspacePath={activeWorkspace.path}
            onClose={() => setShowBranchPicker(false)}
            onSwitch={refresh}
            anchorRef={branchBarRef}
          />
        )}

        {/* Commit input */}
        <div className="px-3 pt-2 pb-1">
          <textarea
            className="w-full bg-[var(--color-bg-input)] border border-[var(--color-border-secondary)] px-2.5 py-1.5 text-xs text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] resize-none focus:outline-none focus:border-[var(--color-accent-blue)]"
            placeholder="Enter commit message"
            rows={3}
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                handleCommit();
              }
            }}
          />
        </div>

        {/* Commit button */}
        <div className="flex items-center justify-end px-3 pt-0 pb-1.5">
          <div className="flex items-center">
            <button
              className="flex items-center gap-1.5 px-3 py-1 bg-[var(--color-bg-elevated)] border border-[var(--color-border-secondary)] text-xs text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={handleCommit}
              disabled={committing || !commitMessage.trim() || stagedCount === 0}
            >
              Commit Tracked
            </button>
          </div>
        </div>

        {/* Last commit */}
        {status?.lastCommitMessage && (
          <div className="flex items-center gap-2 px-3 py-1.5 border-t border-[var(--color-border-primary)] bg-[var(--color-bg-page)]">
            <span className="text-[11px] text-[var(--color-text-tertiary)] truncate flex-1">
              {status.lastCommitMessage}
            </span>
            <button
              className="shrink-0 p-0.5 hover:bg-[var(--color-bg-elevated)] transition-colors cursor-pointer"
              onClick={refresh}
            >
              <HugeiconsIcon
                icon={ArrowReloadHorizontalIcon}
                size={12}
                className="text-[var(--color-text-tertiary)]"
              />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
