import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { HugeiconsIcon } from "@hugeicons/react";
import type { IconSvgElement } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  Folder01Icon,
  Folder02Icon,
  File01Icon,
  FileCodeIcon,
  SourceCodeIcon,
  FileAttachmentIcon,
  FileImageIcon,
  TextFontIcon,
  FileLockIcon,
  FileTerminalIcon,
  Configuration01Icon,
} from "@hugeicons/core-free-icons";
import { create } from "zustand";
import { useLayoutStore } from "../../store/layout.store";
import { useDragStore } from "../../store/drag.store";
import { ContextMenu } from "../../components/shared/ContextMenu";
import type { ContextMenuItem } from "../../components/shared/ContextMenu";
import type { DirEntry } from "./FileTreeTab";

// ── Selection store ──

interface FileTreeSelectionState {
  selectedPaths: Set<string>;
  anchorPath: string | null;
  select: (path: string) => void;
  rangeSelect: (paths: string[]) => void;
  clear: () => void;
}

export const useFileTreeSelection = create<FileTreeSelectionState>((set) => ({
  selectedPaths: new Set(),
  anchorPath: null,
  select: (path) => set({ selectedPaths: new Set([path]), anchorPath: path }),
  rangeSelect: (paths) =>
    set((state) => ({
      selectedPaths: new Set(paths),
      anchorPath: state.anchorPath,
    })),
  clear: () => set({ selectedPaths: new Set(), anchorPath: null }),
}));

// ── Clipboard store ──

interface FileClipboardState {
  clipboard: {
    mode: "cut" | "copy";
    files: Array<{ path: string; name: string }>;
  } | null;
  set: (clipboard: FileClipboardState["clipboard"]) => void;
  clear: () => void;
}

const useFileClipboard = create<FileClipboardState>((set) => ({
  clipboard: null,
  set: (clipboard) => set({ clipboard }),
  clear: () => set({ clipboard: null }),
}));

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

function getParentDir(filePath: string): string {
  const lastSep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return lastSep > 0 ? filePath.substring(0, lastSep) : filePath;
}

function getFileName(filePath: string): string {
  const lastSep = Math.max(filePath.lastIndexOf("/"), filePath.lastIndexOf("\\"));
  return lastSep >= 0 ? filePath.substring(lastSep + 1) : filePath;
}

function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").toLowerCase();
}

function joinPath(dir: string, name: string): string {
  const sep = dir.startsWith("wsl://") || dir.includes("/") ? "/" : "\\";
  return dir.endsWith("/") || dir.endsWith("\\") ? dir + name : dir + sep + name;
}

function getFileIcon(name: string, extension: string | null): IconSvgElement {
  switch (name) {
    case "Cargo.toml":
    case "package.json":
    case "tsconfig.json":
    case "vite.config.ts":
    case "tailwind.config.ts":
      return Configuration01Icon;
    case "Cargo.lock":
    case "bun.lockb":
    case "package-lock.json":
      return FileLockIcon;
    case "Dockerfile":
    case "Makefile":
      return FileTerminalIcon;
  }

  switch (extension) {
    case "ts":
    case "tsx":
    case "js":
    case "jsx":
    case "rs":
    case "py":
    case "go":
    case "rb":
    case "java":
    case "c":
    case "cpp":
    case "h":
    case "css":
    case "scss":
    case "html":
    case "vue":
    case "svelte":
    case "php":
    case "swift":
    case "kt":
    case "sh":
    case "bash":
    case "zsh":
      return FileCodeIcon;
    case "json":
    case "toml":
    case "yaml":
    case "yml":
    case "xml":
      return SourceCodeIcon;
    case "md":
    case "txt":
    case "log":
    case "csv":
      return FileAttachmentIcon;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
    case "ico":
    case "webp":
    case "bmp":
      return FileImageIcon;
    case "ttf":
    case "otf":
    case "woff":
    case "woff2":
      return TextFontIcon;
    default:
      return File01Icon;
  }
}

// ── Inline input ──

function InlineInput({
  depth,
  icon,
  defaultValue,
  onConfirm,
  onCancel,
}: {
  depth: number;
  icon: IconSvgElement;
  defaultValue: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.focus();
    const dotIndex = defaultValue.lastIndexOf(".");
    if (dotIndex > 0) {
      el.setSelectionRange(0, dotIndex);
    } else {
      el.select();
    }
  }, [defaultValue]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter") {
      const value = inputRef.current?.value.trim();
      if (value) onConfirm(value);
      else onCancel();
    } else if (e.key === "Escape") {
      onCancel();
    }
  };

  return (
    <div
      className="relative flex items-center w-full h-[28px] gap-1.5"
      style={{ paddingLeft: LEFT_PAD + depth * INDENT_SIZE }}
    >
      {Array.from({ length: depth }, (_, i) => (
        <span
          key={i}
          className="absolute top-0 bottom-0 w-px bg-[var(--color-border-primary)] opacity-40"
          style={{ left: LEFT_PAD + i * INDENT_SIZE + 8 }}
        />
      ))}
      <span className="w-4 h-4 shrink-0" />
      <HugeiconsIcon icon={icon} size={14} className="shrink-0 text-[var(--color-text-tertiary)]" />
      <input
        ref={inputRef}
        className="flex-1 text-[13px] bg-[var(--color-bg-input)] text-[var(--color-text-primary)] border border-[var(--color-border-focus)] outline-none px-1 min-w-0"
        defaultValue={defaultValue}
        onKeyDown={handleKeyDown}
        onBlur={() => {
          const value = inputRef.current?.value.trim();
          if (value && value !== defaultValue) onConfirm(value);
          else onCancel();
        }}
      />
    </div>
  );
}

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

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const [renaming, setRenaming] = useState(false);
  const [creating, setCreating] = useState<"file" | "dir" | null>(null);

  const refreshDir = useCallback(
    (dirPath: string) => {
      if (normalizePath(dirPath) === normalizePath(entry.path)) {
        // This node IS the directory to refresh — update directly
        invoke<DirEntry[]>("read_dir", { path: dirPath })
          .then((result) => {
            setChildren(result);
            setLoaded(true);
          })
          .catch((e) => console.warn("read_dir failed:", e));
      } else {
        // Target directory is a different node — notify it via event
        window.dispatchEvent(
          new CustomEvent("file-tree-refresh", {
            detail: { dir: dirPath },
          }),
        );
      }
    },
    [entry.path],
  );

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

      const startX = e.clientX;
      const startY = e.clientY;
      dragOccurredRef.current = false;

      const onMouseMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!dragOccurredRef.current && Math.sqrt(dx * dx + dy * dy) > 5) {
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
        }
      };

      const onMouseUp = () => {
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
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

  const targetDir = entry.isDir ? entry.path : getParentDir(entry.path);

  const handleNewFile = useCallback(() => {
    if (entry.isDir) {
      if (!loaded) {
        invoke<DirEntry[]>("read_dir", { path: entry.path }).then((result) => {
          setChildren(result);
          setLoaded(true);
          setExpanded(true);
          setCreating("file");
        });
      } else {
        setExpanded(true);
        setCreating("file");
      }
    } else {
      window.dispatchEvent(
        new CustomEvent("file-tree-create", {
          detail: { dir: targetDir, type: "file" },
        }),
      );
    }
  }, [entry.isDir, entry.path, loaded, targetDir]);

  const handleNewDir = useCallback(() => {
    if (entry.isDir) {
      if (!loaded) {
        invoke<DirEntry[]>("read_dir", { path: entry.path }).then((result) => {
          setChildren(result);
          setLoaded(true);
          setExpanded(true);
          setCreating("dir");
        });
      } else {
        setExpanded(true);
        setCreating("dir");
      }
    } else {
      window.dispatchEvent(
        new CustomEvent("file-tree-create", {
          detail: { dir: targetDir, type: "dir" },
        }),
      );
    }
  }, [entry.isDir, entry.path, loaded, targetDir]);

  const handleCut = useCallback(() => {
    const sel = useFileTreeSelection.getState().selectedPaths;
    const paths = sel.has(entry.path) && sel.size > 1 ? [...sel] : [entry.path];
    setClipboard({
      mode: "cut",
      files: paths.map((p) => ({ path: p, name: getFileName(p) })),
    });
  }, [entry.path, setClipboard]);

  const handleCopy = useCallback(() => {
    const sel = useFileTreeSelection.getState().selectedPaths;
    const paths = sel.has(entry.path) && sel.size > 1 ? [...sel] : [entry.path];
    setClipboard({
      mode: "copy",
      files: paths.map((p) => ({ path: p, name: getFileName(p) })),
    });
  }, [entry.path, setClipboard]);

  const handlePaste = useCallback(async () => {
    if (!clipboard) return;
    try {
      for (const file of clipboard.files) {
        if (clipboard.mode === "copy") {
          await invoke("copy_entry", {
            source: file.path,
            destDir: targetDir,
          });
        } else {
          await invoke("move_file", {
            source: file.path,
            destDir: targetDir,
          });
        }
      }
      if (clipboard.mode === "cut") clearClipboard();
      refreshDir(targetDir);
    } catch {
      // silently fail
    }
  }, [clipboard, targetDir, refreshDir, clearClipboard]);

  const handleRename = useCallback(
    async (newName: string) => {
      try {
        await invoke("rename_entry", { path: entry.path, newName });
        refreshDir(getParentDir(entry.path));
      } catch {
        // silently fail
      }
      setRenaming(false);
    },
    [entry.path, refreshDir],
  );

  const handleCreate = useCallback(
    async (name: string) => {
      const fullPath = joinPath(entry.path, name);
      try {
        if (creating === "dir") {
          await invoke("create_dir", { path: fullPath });
        } else {
          await invoke("create_file", { path: fullPath });
        }
        refreshDir(entry.path);
      } catch {
        // silently fail
      }
      setCreating(null);
    },
    [entry.path, creating, refreshDir],
  );

  const handleReveal = useCallback(() => {
    invoke("reveal_in_explorer", { path: entry.path });
  }, [entry.path]);

  const handleTrash = useCallback(async () => {
    const sel = useFileTreeSelection.getState().selectedPaths;
    const paths = sel.has(entry.path) && sel.size > 1 ? [...sel] : [entry.path];
    const dirsToRefresh = new Set<string>();
    for (const p of paths) {
      try {
        await invoke("trash_entry", { path: p });
        dirsToRefresh.add(getParentDir(p));
      } catch {
        // silently fail
      }
    }
    for (const d of dirsToRefresh) refreshDir(d);
    useFileTreeSelection.getState().clear();
  }, [entry.path, refreshDir]);

  const handleDelete = useCallback(async () => {
    const sel = useFileTreeSelection.getState().selectedPaths;
    const paths = sel.has(entry.path) && sel.size > 1 ? [...sel] : [entry.path];
    const dirsToRefresh = new Set<string>();
    for (const p of paths) {
      try {
        await invoke("delete_entry", { path: p });
        dirsToRefresh.add(getParentDir(p));
      } catch {
        // silently fail
      }
    }
    for (const d of dirsToRefresh) refreshDir(d);
    useFileTreeSelection.getState().clear();
  }, [entry.path, refreshDir]);

  const multiSelected = isSelected && selectionSize > 1;
  const isRoot = depth === 0;
  const contextMenuItems: ContextMenuItem[] = isRoot
    ? [
        { label: "New File", onClick: handleNewFile },
        { label: "New Folder", onClick: handleNewDir },
        { separator: true },
        {
          label: "Paste",
          onClick: handlePaste,
          disabled: !clipboard,
        },
        { separator: true },
        { label: "Reveal in File Explorer", onClick: handleReveal },
      ]
    : [
        { label: "New File", onClick: handleNewFile },
        { label: "New Folder", onClick: handleNewDir },
        { separator: true },
        { label: "Cut", onClick: handleCut },
        { label: "Copy", onClick: handleCopy },
        {
          label: "Paste",
          onClick: handlePaste,
          disabled: !clipboard,
        },
        { separator: true },
        {
          label: "Rename",
          onClick: () => setRenaming(true),
          disabled: multiSelected,
        },
        { separator: true },
        { label: "Reveal in File Explorer", onClick: handleReveal },
        { separator: true },
        { label: "Move to Trash", onClick: handleTrash, destructive: true },
        { label: "Delete", onClick: handleDelete, destructive: true },
      ];

  const icon = entry.isDir
    ? expanded
      ? Folder02Icon
      : Folder01Icon
    : getFileIcon(entry.name, entry.extension);

  if (renaming) {
    return (
      <div>
        <InlineInput
          depth={depth}
          icon={icon}
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
                <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
              </span>
            )}
          </span>
        ) : (
          <span className="w-4 h-4 shrink-0" />
        )}

        {/* Icon */}
        <HugeiconsIcon
          icon={icon}
          size={14}
          className={`shrink-0 ${entry.isDir ? "text-[var(--color-accent-blue)]" : "text-[var(--color-text-tertiary)]"}`}
        />

        {/* Name */}
        <span
          className={`text-[13px] truncate pb-[1px] ${
            entry.name.startsWith(".")
              ? "text-[var(--color-text-secondary)]"
              : "text-[var(--color-text-primary)]"
          }`}
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
              icon={creating === "dir" ? Folder01Icon : File01Icon}
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
