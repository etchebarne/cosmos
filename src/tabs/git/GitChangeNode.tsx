import { useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  ArrowRight01Icon,
  Folder01Icon,
  Folder02Icon,
  File01Icon,
} from "@hugeicons/core-free-icons";
import type { TreeNode, GitFileChange } from "./GitTab";

interface GitChangeNodeProps {
  node: TreeNode;
  depth: number;
  onToggleStage: (node: TreeNode) => void;
}

const INDENT_SIZE = 16;
const LEFT_PAD = 8;

function getNodeFiles(node: TreeNode): GitFileChange[] {
  if (!node.isDir && node.change) return [node.change];
  return node.children.flatMap(getNodeFiles);
}

function getFileIconColor(status: string): string {
  switch (status) {
    case "added":
    case "untracked":
      return "text-[var(--color-status-green)]";
    case "deleted":
      return "text-[var(--color-status-red)]";
    case "modified":
    case "renamed":
    default:
      return "text-[var(--color-status-amber)]";
  }
}

function getCheckState(
  node: TreeNode,
): "checked" | "unchecked" | "indeterminate" {
  const files = getNodeFiles(node);
  if (files.length === 0) return "unchecked";
  const allStaged = files.every((f) => f.staged);
  const someStaged = files.some((f) => f.staged);
  if (allStaged) return "checked";
  if (someStaged) return "indeterminate";
  return "unchecked";
}

function Checkbox({
  state,
  onClick,
}: {
  state: "checked" | "unchecked" | "indeterminate";
  onClick: () => void;
}) {
  return (
    <button
      className="w-[14px] h-[14px] border border-[var(--color-border-secondary)] flex items-center justify-center shrink-0 cursor-pointer hover:border-[var(--color-accent-blue)] transition-colors"
      onClick={(e) => {
        e.stopPropagation();
        onClick();
      }}
    >
      {state === "checked" && (
        <span className="w-2 h-2 bg-[var(--color-accent-blue)]" />
      )}
      {state === "indeterminate" && (
        <span className="w-2 h-0.5 bg-[var(--color-accent-blue)]" />
      )}
    </button>
  );
}

export function GitChangeNode({
  node,
  depth,
  onToggleStage,
}: GitChangeNodeProps) {
  const [expanded, setExpanded] = useState(true);
  const checkState = getCheckState(node);

  const icon = node.isDir
    ? expanded
      ? Folder02Icon
      : Folder01Icon
    : File01Icon;

  return (
    <div>
      <div
        className="relative flex items-center w-full h-[28px] gap-1.5 text-left hover:bg-[var(--color-bg-elevated)] transition-colors select-none cursor-pointer group"
        style={{ paddingLeft: LEFT_PAD + depth * INDENT_SIZE }}
        onClick={() => {
          if (node.isDir) setExpanded((prev) => !prev);
        }}
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
        {node.isDir ? (
          <span className="w-4 h-4 flex items-center justify-center shrink-0 text-[var(--color-text-tertiary)] group-hover:text-[var(--color-text-secondary)] transition-colors">
            <span
              className={`flex items-center justify-center transition-transform duration-200 ${expanded ? "rotate-90" : ""}`}
            >
              <HugeiconsIcon icon={ArrowRight01Icon} size={14} />
            </span>
          </span>
        ) : (
          <span className="w-4 h-4 shrink-0" />
        )}

        {/* Icon */}
        <HugeiconsIcon
          icon={icon}
          size={14}
          className={`shrink-0 ${node.isDir ? "text-[var(--color-accent-blue)]" : node.change ? getFileIconColor(node.change.status) : "text-[var(--color-text-tertiary)]"}`}
        />

        {/* Name */}
        <span className="text-[13px] text-[var(--color-text-primary)] truncate pb-[1px] flex-1">
          {node.name}
        </span>

        {/* Diff stats (only for files) */}
        {!node.isDir &&
          node.change &&
          (node.change.additions > 0 || node.change.deletions > 0) && (
            <span className="flex items-center gap-1.5 text-[11px] mr-1">
              {node.change.additions > 0 && (
                <span className="text-[var(--color-status-green)]">
                  + {node.change.additions}
                </span>
              )}
              {node.change.deletions > 0 && (
                <span className="text-[var(--color-status-red)]">
                  &minus; {node.change.deletions}
                </span>
              )}
            </span>
          )}

        {/* Checkbox */}
        <span className="mr-2">
          <Checkbox
            state={checkState}
            onClick={() => onToggleStage(node)}
          />
        </span>
      </div>

      {/* Children */}
      {node.isDir && expanded && (
        <div className="relative">
          {node.children.map((child) => (
            <GitChangeNode
              key={child.path}
              node={child}
              depth={depth + 1}
              onToggleStage={onToggleStage}
            />
          ))}
        </div>
      )}
    </div>
  );
}
