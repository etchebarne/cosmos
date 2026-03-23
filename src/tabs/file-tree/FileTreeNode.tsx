import { useState, useCallback, useRef, useEffect, useContext } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { CaretRight, Folder, FolderOpen, File } from "@phosphor-icons/react";
import { useLayoutStore } from "../../store/layout.store";
import { useIsDarkTheme } from "../../lib/themes";
import { useDragStore } from "../../store/drag.store";
import { startDragThreshold } from "../../lib/drag-threshold";
import { getFileName, getParentDir, normalizePath } from "../../lib/path-utils";
import { ContextMenu } from "../../components/shared/ContextMenu";
import type { DirEntry } from "./FileTreeTab";
import { useFileTreeSelection, useFileClipboard } from "./file-tree-stores";
import { GitFileTreeContext } from "./git-file-tree-context";
import { FileIcon } from "./file-icons";
import { InlineInput } from "./InlineInput";
import { useFileTreeActions } from "./useFileTreeActions";

// ── Helpers ──

interface FileTreeNodeProps {
  entry: DirEntry;
  depth: number;
  paneId: string;
  defaultExpanded?: boolean;
  preloadedChildren?: DirEntry[];
}

const INDENT_SIZE = 16;
const LEFT_PAD = 8;

// ── Main component ──

export function FileTreeNode({
  entry,
  depth,
  paneId,
  defaultExpanded,
  preloadedChildren,
}: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  const [children, setChildren] = useState<DirEntry[]>(preloadedChildren ?? []);
  const [loaded, setLoaded] = useState(!!preloadedChildren);
  const [loading, setLoading] = useState(false);
  const openFile = useLayoutStore((s) => s.openFile);
  const setDragState = useDragStore((s) => s.setDragState);
  const clipboard = useFileClipboard((s) => s.clipboard);
  const setClipboard = useFileClipboard((s) => s.set);
  const clearClipboard = useFileClipboard((s) => s.clear);
  const isSelected = useFileTreeSelection((s) => s.selectedPaths.has(entry.path));
  const selectionSize = useFileTreeSelection((s) => s.selectedPaths.size);
  const dragOccurredRef = useRef(false);
  const isCut = clipboard?.mode === "cut" && clipboard.files.some((f) => f.path === entry.path);
  const getGitColor = useContext(GitFileTreeContext);
  const gitColor = getGitColor(entry.path, entry.isDir);
  const isDark = useIsDarkTheme();

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [creating, setCreating] = useState<"file" | "dir" | null>(null);

  const refreshDir = useCallback(
    (dirPath: string) => {
      if (normalizePath(dirPath) === normalizePath(entry.path)) {
        invoke<DirEntry[]>("read_dir", { path: dirPath })
          .then((result) => {
            setChildren(result);
            setLoaded(true);
          })
          .catch((e) => console.warn("read_dir failed:", e));
      } else {
        window.dispatchEvent(
          new CustomEvent("file-tree-refresh", {
            detail: { dir: dirPath },
          }),
        );
      }
    },
    [entry.path],
  );

  const { handleRename, handleCreate, contextMenuItems } = useFileTreeActions({
    entry,
    depth,
    loaded,
    creating,
    clipboard,
    isSelected,
    selectionSize,
    setChildren,
    setLoaded,
    setExpanded,
    setCreating,
    setRenaming,
    setClipboard,
    clearClipboard,
    refreshDir,
  });

  const handleClick = useCallback(
    async (e: React.MouseEvent) => {
      if (dragOccurredRef.current) return;

      if (e.shiftKey) {
        // Range select from anchor to this entry
        const { anchorPath } = useFileTreeSelection.getState();
        if (anchorPath) {
          const allButtons = Array.from(
            document.querySelectorAll<HTMLElement>("[data-entry-path]"),
          );
          const paths = allButtons.map((el) => el.dataset.entryPath!);
          const anchorIdx = paths.findIndex((p) => normalizePath(p) === normalizePath(anchorPath));
          const targetIdx = paths.findIndex((p) => normalizePath(p) === normalizePath(entry.path));
          if (anchorIdx >= 0 && targetIdx >= 0) {
            const start = Math.min(anchorIdx, targetIdx);
            const end = Math.max(anchorIdx, targetIdx);
            useFileTreeSelection.getState().rangeSelect(paths.slice(start, end + 1));
          }
        } else {
          useFileTreeSelection.getState().select(entry.path);
        }
        return;
      }

      // Normal click
      useFileTreeSelection.getState().select(entry.path);

      if (entry.isDir) {
        if (!loaded) {
          setLoading(true);
          try {
            const result = await invoke<DirEntry[]>("read_dir", {
              path: entry.path,
            });
            setChildren(result);
            setLoaded(true);
            setExpanded(true);
          } catch {
            // silently fail for unreadable dirs
          } finally {
            setLoading(false);
          }
        } else {
          setExpanded((prev) => !prev);
        }
      } else {
        openFile(entry.path, entry.name, paneId);
      }
    },
    [entry, loaded, openFile, paneId],
  );

  // Listen for file move events to surgically update children
  useEffect(() => {
    if (!entry.isDir) return;

    const handler = (e: Event) => {
      const { sourcePath, destDir } = (e as CustomEvent).detail;
      const sourceDir = getParentDir(sourcePath);

      if (entry.path === sourceDir) {
        setChildren((prev) => prev.filter((c) => c.path !== sourcePath));
      }

      if (entry.path === destDir) {
        invoke<DirEntry[]>("read_dir", { path: entry.path }).then((result) => {
          setChildren(result);
          setLoaded(true);
          setExpanded(true);
        });
      }
    };

    window.addEventListener("file-tree-move", handler);
    return () => window.removeEventListener("file-tree-move", handler);
  }, [entry.isDir, entry.path]);

  // Listen for external filesystem changes to refresh directory contents
  useEffect(() => {
    if (!entry.isDir || !loaded) return;

    const normalized = normalizePath(entry.path);
    const unlisten = listen<string[]>("file-tree-changed", (event) => {
      if (event.payload.some((dir) => normalizePath(dir) === normalized)) {
        invoke<DirEntry[]>("read_dir", { path: entry.path })
          .then((result) => setChildren(result))
          .catch((e) => console.warn("read_dir failed:", e));
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [entry.isDir, entry.path, loaded]);

  // Listen for create requests from child file nodes targeting this directory
  useEffect(() => {
    if (!entry.isDir) return;

    const handler = (e: Event) => {
      const { dir, type } = (e as CustomEvent).detail;
      if (normalizePath(dir) === normalizePath(entry.path)) {
        if (!loaded) {
          invoke<DirEntry[]>("read_dir", { path: entry.path }).then((result) => {
            setChildren(result);
            setLoaded(true);
            setExpanded(true);
            setCreating(type);
          });
        } else {
          setExpanded(true);
          setCreating(type);
        }
      }
    };

    window.addEventListener("file-tree-create", handler);
    return () => window.removeEventListener("file-tree-create", handler);
  }, [entry.isDir, entry.path, loaded]);

  // Listen for refresh requests from child nodes (e.g. after rename/trash/delete)
  useEffect(() => {
    if (!entry.isDir) return;

    const normalized = normalizePath(entry.path);
    const handler = (e: Event) => {
      const { dir } = (e as CustomEvent).detail;
      if (normalizePath(dir) === normalized) {
        invoke<DirEntry[]>("read_dir", { path: entry.path })
          .then((result) => {
            setChildren(result);
            setLoaded(true);
          })
          .catch((e) => console.warn("read_dir failed:", e));
      }
    };

    window.addEventListener("file-tree-refresh", handler);
    return () => window.removeEventListener("file-tree-refresh", handler);
  }, [entry.isDir, entry.path]);

  const handleFileMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0 || e.shiftKey) return;

      // Directories at the root level (depth 0) aren't draggable
      if (entry.isDir && depth === 0) return;

      dragOccurredRef.current = false;

      startDragThreshold(
        e.clientX,
        e.clientY,
        () => {
          dragOccurredRef.current = true;
          const sel = useFileTreeSelection.getState().selectedPaths;
          if (sel.has(entry.path) && sel.size > 1) {
            const files = [...sel].map((p) => {
              const el = document.querySelector<HTMLElement>(
                `[data-entry-path="${CSS.escape(p)}"]`,
              );
              const dirPath = el?.dataset.dirPath;
              return {
                filePath: p,
                fileName: getFileName(p),
                isDir: dirPath === p,
              };
            });
            setDragState({ type: "file", files });
          } else {
            setDragState({
              type: "file",
              files: [
                {
                  filePath: entry.path,
                  fileName: entry.name,
                  isDir: entry.isDir,
                },
              ],
            });
          }
        },
        () => {}, // click is handled by the onClick handler
      );
    },
    [entry, setDragState],
  );

  const handleContextMenu = useCallback(
    (e: React.MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      // If right-clicking an unselected entry, select it alone
      if (!useFileTreeSelection.getState().selectedPaths.has(entry.path)) {
        useFileTreeSelection.getState().select(entry.path);
      }
      setContextMenu({ x: e.clientX, y: e.clientY });
    },
    [entry.path],
  );

  const dirIcon = entry.isDir ? (expanded ? FolderOpen : Folder) : null;

  const renderIcon = (size: number, className?: string) => {
    if (dirIcon) {
      const DirComp = dirIcon;
      return <DirComp size={size} className={className} />;
    }
    return (
      <FileIcon
        name={entry.name}
        extension={entry.extension}
        size={size}
        className={className}
        isDark={isDark}
      />
    );
  };

  if (renaming) {
    return (
      <div>
        <InlineInput
          depth={depth}
          iconNode={renderIcon(14, "shrink-0 text-[var(--color-text-tertiary)]")}
          defaultValue={entry.name}
          onConfirm={handleRename}
          onCancel={() => setRenaming(false)}
        />
        {expanded && (
          <div className="relative">
            {children.map((child) => (
              <FileTreeNode key={child.path} entry={child} depth={depth + 1} paneId={paneId} />
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div>
      <button
        className={`relative flex items-center w-full h-[28px] gap-1.5 text-left focus:outline-none transition-colors select-none cursor-pointer group ${
          isSelected ? "bg-[var(--color-accent-blue-muted)]" : "hover:bg-[var(--color-bg-elevated)]"
        } ${isCut ? "opacity-40" : ""}`}
        style={{ paddingLeft: LEFT_PAD + depth * INDENT_SIZE }}
        onClick={handleClick}
        onMouseDown={handleFileMouseDown}
        onContextMenu={handleContextMenu}
        data-entry-path={entry.path}
        data-dir-path={entry.isDir ? entry.path : getParentDir(entry.path)}
      >
        {/* Indent guide lines */}
        {Array.from({ length: depth }, (_, i) => (
          <span
            key={i}
            className="absolute top-0 bottom-0 w-px bg-[var(--color-border-primary)] opacity-40"
            style={{ left: LEFT_PAD + i * INDENT_SIZE + 8 }}
          />
        ))}

        {/* Chevron for directories */}
        {entry.isDir ? (
          <span className="w-4 h-4 flex items-center justify-center shrink-0 text-[var(--color-text-tertiary)] group-hover:text-[var(--color-text-secondary)] transition-colors">
            {loading ? (
              <span className="w-3 h-3 border border-[var(--color-text-muted)] border-t-transparent animate-spin rounded-full" />
            ) : (
              <span
                className={`flex items-center justify-center transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
              >
                <CaretRight size={14} />
              </span>
            )}
          </span>
        ) : (
          <span className="w-4 h-4 shrink-0" />
        )}

        {/* Icon */}
        {renderIcon(
          14,
          `shrink-0 ${entry.isDir ? "text-[var(--color-accent-blue)]" : "text-[var(--color-text-tertiary)]"}`,
        )}

        {/* Name */}
        <span
          className={`text-[13px] truncate pb-[1px] ${gitColor ?? "text-[var(--color-text-primary)]"}`}
        >
          {entry.name}
        </span>
      </button>

      {/* Children with guide lines */}
      {expanded && (
        <div className="relative">
          {creating && (
            <InlineInput
              depth={depth + 1}
              iconNode={
                creating === "dir" ? (
                  <Folder size={14} className="shrink-0 text-[var(--color-text-tertiary)]" />
                ) : (
                  <File size={14} className="shrink-0 text-[var(--color-text-tertiary)]" />
                )
              }
              defaultValue=""
              onConfirm={handleCreate}
              onCancel={() => setCreating(null)}
            />
          )}
          {children.map((child) => (
            <FileTreeNode key={child.path} entry={child} depth={depth + 1} paneId={paneId} />
          ))}
        </div>
      )}

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={contextMenuItems}
          onClose={() => setContextMenu(null)}
        />
      )}
    </div>
  );
}
