import { useState, useCallback } from "react";
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
import type { DirEntry } from "./FileTreeTab";

interface FileTreeNodeProps {
  entry: DirEntry;
  depth: number;
  defaultExpanded?: boolean;
  preloadedChildren?: DirEntry[];
}

const INDENT_SIZE = 16;
const LEFT_PAD = 8;

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

export function FileTreeNode({ entry, depth, defaultExpanded, preloadedChildren }: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(defaultExpanded ?? false);
  const [children, setChildren] = useState<DirEntry[]>(preloadedChildren ?? []);
  const [loaded, setLoaded] = useState(!!preloadedChildren);
  const [loading, setLoading] = useState(false);

  const toggle = useCallback(async () => {
    if (!entry.isDir) return;

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
  }, [entry, loaded]);

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
        onClick={toggle}
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
              <span className={`flex items-center justify-center transition-transform duration-200 ${expanded ? 'rotate-90' : ''}`}>
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
            <FileTreeNode key={child.path} entry={child} depth={depth + 1} />
          ))}
        </div>
      )}
    </div>
  );
}
