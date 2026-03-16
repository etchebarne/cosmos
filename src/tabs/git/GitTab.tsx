import { useState, useCallback, useRef, type MouseEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  GitBranchIcon,
  ArrowDown01Icon,
  ArrowReloadHorizontalIcon,
  Tick02Icon,
  Loading03Icon,
  MoreHorizontalIcon,
} from "@hugeicons/core-free-icons";
import { useActiveWorkspace, useIsWorkspaceActive } from "../../contexts/WorkspaceContext";
import { GitChangeNode } from "./GitChangeNode";
import { ScrollArea } from "../../components/shared/ScrollArea";
import { ContextMenu } from "../../components/shared/ContextMenu";
import type { ContextMenuItem } from "../../components/shared/ContextMenu";
import { BranchPicker } from "./BranchPicker";
import { StashDialog } from "./StashDialog";
import { useGitStatus } from "../../hooks/use-git-status";
import { useGitActions, GIT_ACTIONS } from "../../hooks/use-git-actions";
import { useClickOutside } from "../../hooks/use-click-outside";
import { buildChangeTree, getNodeFiles } from "../../lib/git-tree";
import type { TreeNode } from "../../lib/git-tree";
import { useLayoutStore } from "../../store/layout.store";
import type { TabContentProps } from "../types";

export function GitTab({ tab: _tab, paneId }: TabContentProps) {
  const activeWorkspace = useActiveWorkspace();
  const isActive = useIsWorkspaceActive();
  const workspacePath = activeWorkspace?.path ?? null;

  const { status, loading, error, setError, refresh } = useGitStatus(workspacePath, isActive);
  const { activeAction, actionRunning, actionDone, currentAction, handleRunAction } = useGitActions(
    workspacePath,
    refresh,
    setError,
  );

  const [commitMessage, setCommitMessage] = useState("");
  const [committing, setCommitting] = useState(false);
  const [showBranchPicker, setShowBranchPicker] = useState(false);
  const [showActionMenu, setShowActionMenu] = useState(false);
  const [showMoreMenu, setShowMoreMenu] = useState(false);
  const [showStashDialog, setShowStashDialog] = useState(false);
  const moreMenuRef = useRef<HTMLDivElement>(null);
  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    items: ContextMenuItem[];
  } | null>(null);
  const branchBarRef = useRef<HTMLDivElement>(null);
  const actionMenuRef = useRef<HTMLDivElement>(null);

  useClickOutside(actionMenuRef, () => setShowActionMenu(false), showActionMenu);

  useClickOutside(moreMenuRef, () => setShowMoreMenu(false), showMoreMenu);

  const handleStageAll = useCallback(async () => {
    if (!workspacePath) return;
    try {
      await invoke("git_stage_all", { path: workspacePath });
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }, [workspacePath, refresh, setError]);

  const handleUnstageAll = useCallback(async () => {
    if (!workspacePath || !status) return;
    try {
      const stagedFiles = status.changes.filter((c) => c.staged).map((c) => c.path);
      if (stagedFiles.length > 0) {
        await invoke("git_unstage", {
          path: workspacePath,
          files: stagedFiles,
        });
        refresh();
      }
    } catch (e) {
      setError(String(e));
    }
  }, [workspacePath, status, refresh, setError]);

  const handleToggleStage = useCallback(
    async (node: TreeNode) => {
      if (!workspacePath) return;
      const files = getNodeFiles(node).map((f) => f.path);
      const allStaged = getNodeFiles(node).every((f) => f.staged);
      try {
        if (allStaged) {
          await invoke("git_unstage", {
            path: workspacePath,
            files,
          });
        } else {
          await invoke("git_stage", { path: workspacePath, files });
        }
        refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [workspacePath, refresh, setError],
  );

  const handleCommit = useCallback(async () => {
    if (!workspacePath || !commitMessage.trim()) return;
    setCommitting(true);
    try {
      await invoke("git_commit", {
        path: workspacePath,
        message: commitMessage,
      });
      setCommitMessage("");
      refresh();
    } catch (e) {
      setError(String(e));
    } finally {
      setCommitting(false);
    }
  }, [workspacePath, commitMessage, refresh, setError]);

  const handleInit = useCallback(async () => {
    if (!workspacePath) return;
    try {
      await invoke("git_init", { path: workspacePath });
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }, [workspacePath, refresh, setError]);

  const handleStashAll = useCallback(async () => {
    if (!workspacePath) return;
    try {
      await invoke("git_stash_all", { path: workspacePath });
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }, [workspacePath, refresh, setError]);

  const handleStashFiles = useCallback(
    async (node: TreeNode) => {
      if (!workspacePath) return;
      const files = getNodeFiles(node).map((f) => f.path);
      try {
        await invoke("git_stash_files", { path: workspacePath, files });
        refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [workspacePath, refresh, setError],
  );

  const handleDiscardAllTracked = useCallback(async () => {
    if (!workspacePath) return;
    try {
      await invoke("git_discard_all_tracked", { path: workspacePath });
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }, [workspacePath, refresh, setError]);

  const handleTrashAllUntracked = useCallback(async () => {
    if (!workspacePath) return;
    try {
      await invoke("git_trash_all_untracked", { path: workspacePath });
      refresh();
    } catch (e) {
      setError(String(e));
    }
  }, [workspacePath, refresh, setError]);

  const handleDiscard = useCallback(
    async (node: TreeNode) => {
      if (!workspacePath) return;
      const files = getNodeFiles(node).map((f) => f.path);
      try {
        await invoke("git_discard", { path: workspacePath, files });
        refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [workspacePath, refresh, setError],
  );

  const handleTrash = useCallback(
    async (node: TreeNode) => {
      if (!workspacePath) return;
      const files = getNodeFiles(node).map((f) => f.path);
      try {
        await invoke("git_trash_untracked", { path: workspacePath, files });
        refresh();
      } catch (e) {
        setError(String(e));
      }
    },
    [workspacePath, refresh, setError],
  );

  const handleFileClick = useCallback(
    (node: TreeNode) => {
      if (node.isDir || !node.change) return;
      const fileName = node.name;
      const isUntracked = node.change.status === "untracked";
      useLayoutStore
        .getState()
        .openChanges(node.change.path, fileName, node.change.staged, isUntracked, paneId);
    },
    [paneId],
  );

  const handleNodeContextMenu = useCallback(
    (e: MouseEvent, node: TreeNode) => {
      e.preventDefault();
      const files = getNodeFiles(node);
      const isUntracked = files.every((f) => f.status === "untracked");
      const items: ContextMenuItem[] = isUntracked
        ? [{ label: "Trash", onClick: () => handleTrash(node) }]
        : [
            { label: "Stash", onClick: () => handleStashFiles(node) },
            { label: "Discard Changes", onClick: () => handleDiscard(node) },
          ];
      setContextMenu({ x: e.clientX, y: e.clientY, items });
    },
    [handleDiscard, handleTrash, handleStashFiles],
  );

  if (!activeWorkspace) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-[var(--color-text-muted)]">No workspace open</p>
      </div>
    );
  }

  if (loading && !status) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-[var(--color-text-secondary)]">Loading...</p>
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
          className="px-3 py-1.5 text-xs text-[var(--color-text-primary)] bg-[var(--color-bg-elevated)] border border-[var(--color-border-secondary)] hover:bg-[var(--color-bg-surface)] transition-colors cursor-pointer rounded-none"
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
        <div className="flex items-center gap-1">
          <button
            className="text-xs text-[var(--color-accent-blue)] hover:text-[var(--color-accent-blue-hover)] transition-colors cursor-pointer"
            onClick={allStaged ? handleUnstageAll : handleStageAll}
          >
            {allStaged ? "Unstage All" : "Stage All"}
          </button>
          <div className="relative" ref={moreMenuRef}>
            <button
              className="p-1 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] transition-colors cursor-pointer"
              onClick={() => setShowMoreMenu((v) => !v)}
            >
              <HugeiconsIcon icon={MoreHorizontalIcon} size={14} />
            </button>
            {showMoreMenu && (
              <div className="absolute top-full right-0 mt-1 min-w-[180px] py-1 bg-[var(--color-bg-elevated)] border border-[var(--color-border-primary)] shadow-lg z-50">
                <button
                  className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-input)] hover:text-[var(--color-text-primary)] cursor-pointer"
                  onClick={() => {
                    setShowMoreMenu(false);
                    handleStashAll();
                  }}
                >
                  Stash All
                </button>
                <button
                  className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-input)] hover:text-[var(--color-text-primary)] cursor-pointer"
                  onClick={() => {
                    setShowMoreMenu(false);
                    setShowStashDialog(true);
                  }}
                >
                  View Stash
                </button>
                <div className="my-1 border-t border-[var(--color-border-primary)]" />
                <button
                  className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-input)] hover:text-[var(--color-text-primary)] cursor-pointer"
                  onClick={() => {
                    setShowMoreMenu(false);
                    handleDiscardAllTracked();
                  }}
                >
                  Discard Tracked Changes
                </button>
                <button
                  className="w-full text-left px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-input)] hover:text-[var(--color-text-primary)] cursor-pointer"
                  onClick={() => {
                    setShowMoreMenu(false);
                    handleTrashAllUntracked();
                  }}
                >
                  Trash Untracked Files
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Changes tree */}
      <ScrollArea className="flex-1">
        {changes.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <p className="text-xs text-[var(--color-text-muted)]">No changes</p>
          </div>
        ) : (
          <div className="pt-1 pb-4">
            {tracked.length > 0 && (
              <>
                <div className="px-3 py-1">
                  <span className="text-[11px] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider">
                    Tracked
                  </span>
                </div>
                {trackedTree.map((node) => (
                  <GitChangeNode
                    key={node.path}
                    node={node}
                    depth={0}
                    isUntracked={false}
                    onToggleStage={handleToggleStage}
                    onContextMenu={handleNodeContextMenu}
                    onFileClick={handleFileClick}
                  />
                ))}
              </>
            )}
            {untracked.length > 0 && (
              <>
                <div className="px-3 py-1 mt-2">
                  <span className="text-[11px] font-medium text-[var(--color-text-tertiary)] uppercase tracking-wider">
                    Untracked
                  </span>
                </div>
                {untrackedTree.map((node) => (
                  <GitChangeNode
                    key={node.path}
                    node={node}
                    depth={0}
                    isUntracked={true}
                    onToggleStage={handleToggleStage}
                    onContextMenu={handleNodeContextMenu}
                    onFileClick={handleFileClick}
                  />
                ))}
              </>
            )}
          </div>
        )}
      </ScrollArea>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenu.items}
          onClose={() => setContextMenu(null)}
        />
      )}

      {workspacePath && (
        <StashDialog
          open={showStashDialog}
          onClose={() => setShowStashDialog(false)}
          workspacePath={workspacePath}
          onApply={refresh}
        />
      )}

      {/* Bottom section */}
      <div className="border-t border-[var(--color-border-primary)] bg-[var(--color-bg-page)]">
        {/* Branch bar */}
        <div
          ref={branchBarRef}
          className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--color-border-primary)]"
        >
          <button
            className="flex items-center gap-1.5 min-w-0 hover:bg-[var(--color-bg-elevated)] transition-colors cursor-pointer px-1.5 py-1 -mx-1.5 rounded-none group"
            onClick={() => setShowBranchPicker((v) => !v)}
          >
            <HugeiconsIcon
              icon={GitBranchIcon}
              size={14}
              className="text-[var(--color-status-green)] shrink-0"
            />
            <span className="text-xs text-[var(--color-text-primary)] truncate font-medium group-hover:text-[var(--color-accent-blue)] transition-colors">
              {status?.remoteBranch
                ? status.remoteBranch.replace(/\//, " / ")
                : (status?.branch ?? "\u2014")}
            </span>
            <HugeiconsIcon
              icon={ArrowDown01Icon}
              size={12}
              className="text-[var(--color-text-tertiary)] shrink-0"
            />
          </button>

          <div className="relative flex items-center" ref={actionMenuRef}>
            <div className="flex bg-[var(--color-bg-elevated)] border border-[var(--color-border-secondary)] rounded-none overflow-hidden">
              <button
                className="flex items-center gap-1.5 px-2 py-0.5 text-[11px] text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed rounded-none border-r border-[var(--color-border-secondary)]"
                onClick={() => handleRunAction()}
                disabled={actionRunning || !status?.hasRemote}
              >
                <HugeiconsIcon
                  icon={
                    actionDone
                      ? Tick02Icon
                      : actionRunning
                        ? Loading03Icon
                        : ArrowReloadHorizontalIcon
                  }
                  size={12}
                  className={`${actionDone ? "text-[var(--color-status-green)]" : ""} ${actionRunning ? "animate-spin" : ""}`}
                />
                <span className="font-medium">{currentAction.label}</span>
              </button>
              <button
                className="flex items-center px-1 py-0.5 text-[var(--color-text-tertiary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed rounded-none"
                onClick={() => setShowActionMenu((v) => !v)}
                disabled={!status?.hasRemote}
              >
                <HugeiconsIcon icon={ArrowDown01Icon} size={12} />
              </button>
            </div>
            {showActionMenu && (
              <div className="absolute bottom-full right-0 mb-1 min-w-[140px] bg-[var(--color-bg-elevated)] border border-[var(--color-border-secondary)] shadow-lg z-50">
                {GIT_ACTIONS.map((action) => (
                  <button
                    key={action.key}
                    className={`w-full text-left px-3 py-2 text-xs transition-colors cursor-pointer rounded-none ${
                      action.key === activeAction
                        ? "text-[var(--color-text-primary)] bg-[var(--color-bg-surface)] font-medium"
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
        <div className="p-3">
          <textarea
            className="w-full bg-[var(--color-bg-input)] border border-[var(--color-border-secondary)] px-3 py-2.5 text-[13px] text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] resize-none focus:outline-none focus:border-[var(--color-accent-blue)] focus:ring-1 focus:ring-[var(--color-accent-blue)] rounded-none transition-all"
            placeholder="Commit message (Cmd+Enter to commit)"
            rows={3}
            value={commitMessage}
            onChange={(e) => setCommitMessage(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
                handleCommit();
              }
            }}
          />
          <div className="flex items-center justify-end mt-2">
            <button
              className="flex items-center gap-1.5 px-2.5 py-0.5 bg-[var(--color-bg-elevated)] border border-[var(--color-border-secondary)] text-[11px] font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-bg-surface)] transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed rounded-none"
              onClick={handleCommit}
              disabled={committing || !commitMessage.trim() || stagedCount === 0}
            >
              Commit Tracked
            </button>
          </div>
        </div>

        {/* Last commit */}
        {status?.lastCommitMessage && (
          <div className="flex items-center gap-2 px-3 py-2 border-t border-[var(--color-border-primary)] bg-[var(--color-bg-elevated)]">
            <span className="text-[11px] text-[var(--color-text-tertiary)] truncate flex-1 font-mono">
              {status.lastCommitMessage}
            </span>
            <button
              className="shrink-0 p-1 hover:bg-[var(--color-bg-surface)] transition-colors cursor-pointer rounded-none group"
              onClick={refresh}
              title="Refresh Git Status"
            >
              <HugeiconsIcon
                icon={ArrowReloadHorizontalIcon}
                size={14}
                className="text-[var(--color-text-tertiary)] group-hover:text-[var(--color-text-primary)] transition-colors"
              />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
