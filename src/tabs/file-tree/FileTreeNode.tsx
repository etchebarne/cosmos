import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
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
import { useLayoutStore } from "../../store/layout.store";
import { useDragStore } from "../../store/drag.store";
import type { DirEntry } from "./FileTreeTab";

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

function getFileIcon(name: string, extension: string | null): IconSvgElement {
  // Special filenames
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
  const dragOccurredRef = useRef(false);

  const handleClick = useCallback(async () => {
    if (dragOccurredRef.current) return;
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
  }, [entry, loaded, openFile, paneId]);

  // Listen for file move events to surgically update children
  useEffect(() => {
    if (!entry.isDir) return;

    const handler = (e: Event) => {
      const { sourcePath, destDir } = (e as CustomEvent).detail;
      const sourceDir = getParentDir(sourcePath);

      // Remove from this directory if source was here
      if (entry.path === sourceDir) {
        setChildren((prev) => prev.filter((c) => c.path !== sourcePath));
      }

      // Reload this directory if destination is here, and expand it
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

  const handleFileMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0 || entry.isDir) return;

      const startX = e.clientX;
      const startY = e.clientY;
      dragOccurredRef.current = false;

      const onMouseMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!dragOccurredRef.current && Math.sqrt(dx * dx + dy * dy) > 5) {
          dragOccurredRef.current = true;
          setDragState({ type: "file", filePath: entry.path, fileName: entry.name });
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

  const icon = entry.isDir
    ? expanded
      ? Folder02Icon
      : Folder01Icon
    : getFileIcon(entry.name, entry.extension);

  return (
    <div>
      <button
        className="relative flex items-center w-full h-[28px] gap-1.5 text-left hover:bg-[var(--color-bg-elevated)] focus:bg-[var(--color-bg-elevated)] focus:outline-none transition-colors select-none cursor-pointer group"
        style={{ paddingLeft: LEFT_PAD + depth * INDENT_SIZE }}
        onClick={handleClick}
        onMouseDown={handleFileMouseDown}
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
          {children.map((child) => (
            <FileTreeNode key={child.path} entry={child} depth={depth + 1} paneId={paneId} />
          ))}
        </div>
      )}
    </div>
  );
}
