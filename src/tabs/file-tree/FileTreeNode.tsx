import { useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  ChevronRight,
  ChevronDown,
  Folder,
  File,
  FileCode,
  FileJson,
  FileText,
  FileImage,
  FileType,
} from "lucide-react";
import type { DirEntry } from "./FileTreeTab";

interface FileTreeNodeProps {
  entry: DirEntry;
  depth: number;
}

function getFileIcon(extension: string | null) {
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
      return FileCode;
    case "json":
    case "toml":
    case "yaml":
    case "yml":
      return FileJson;
    case "md":
    case "txt":
    case "log":
      return FileText;
    case "png":
    case "jpg":
    case "jpeg":
    case "gif":
    case "svg":
    case "ico":
    case "webp":
      return FileImage;
    case "ttf":
    case "otf":
    case "woff":
    case "woff2":
      return FileType;
    default:
      return File;
  }
}

export function FileTreeNode({ entry, depth }: FileTreeNodeProps) {
  const [expanded, setExpanded] = useState(false);
  const [children, setChildren] = useState<DirEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
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

  const paddingLeft = 12 + depth * 16;
  const Icon = entry.isDir ? Folder : getFileIcon(entry.extension);

  return (
    <div>
      <button
        className="flex items-center w-full h-[26px] gap-1.5 text-left hover:bg-[var(--color-bg-elevated)] transition-colors group select-none"
        style={{ paddingLeft }}
        onClick={toggle}
      >
        {entry.isDir ? (
          <span className="w-4 h-4 flex items-center justify-center shrink-0 text-[var(--color-text-tertiary)]">
            {loading ? (
              <span className="w-3 h-3 border border-[var(--color-text-muted)] border-t-transparent animate-spin" />
            ) : expanded ? (
              <ChevronDown size={14} />
            ) : (
              <ChevronRight size={14} />
            )}
          </span>
        ) : (
          <span className="w-4 h-4 shrink-0" />
        )}
        <Icon
          size={14}
          className={`shrink-0 ${entry.isDir ? "text-[var(--color-accent-blue)]" : "text-[var(--color-text-tertiary)]"}`}
        />
        <span className="text-xs text-[var(--color-text-primary)] truncate">
          {entry.name}
        </span>
      </button>
      {expanded &&
        children.map((child) => (
          <FileTreeNode key={child.path} entry={child} depth={depth + 1} />
        ))}
    </div>
  );
}
