import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { PatchDiff } from "@pierre/diffs/react";
import { registerCustomTheme } from "@pierre/diffs";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { useActiveWorkspace } from "../../contexts/WorkspaceContext";
import type { TabContentProps } from "../types";

// Register a custom theme that matches the cosmos editor colors
let themeRegistered = false;
function ensureTheme() {
  if (themeRegistered) return;
  themeRegistered = true;
  registerCustomTheme("cosmos-dark", async () => {
    const m = (await import("@pierre/theme/themes/pierre-dark.json")) as {
      default: Record<string, unknown>;
    };
    const base = m.default ?? m;
    return {
      ...base,
      name: "cosmos-dark",
      colors: {
        ...(base.colors as Record<string, string>),
        "editor.background": "#111116",
        "editor.foreground": "#e8e8ed",
        "editorLineNumber.foreground": "#4a4a58",
        "editorLineNumber.activeForeground": "#6b6b78",
        "diffEditor.insertedTextBackground": "#34d39918",
        "diffEditor.deletedTextBackground": "#f8717118",
      },
    };
  });
}
ensureTheme();

const THEME_CSS = `
  [data-separator] [data-separator-wrapper] {
    background-color: #1a1a22 !important;
    border-radius: 0 !important;
  }
  [data-separator-content] {
    color: #6b6b78 !important;
  }
  :host {
    --diffs-bg-buffer-override: #111116;
    --diffs-bg-hover-override: #1a1a22;
    --diffs-bg-context-override: #111116;
    --diffs-bg-separator-override: #1a1a22;
    --diffs-fg-number-override: #4a4a58;
    --diffs-bg-deletion-override: rgba(248, 113, 113, 0.06);
    --diffs-bg-deletion-number-override: rgba(248, 113, 113, 0.10);
    --diffs-bg-deletion-hover-override: rgba(248, 113, 113, 0.10);
    --diffs-bg-deletion-emphasis-override: rgba(248, 113, 113, 0.20);
    --diffs-bg-addition-override: rgba(52, 211, 153, 0.06);
    --diffs-bg-addition-number-override: rgba(52, 211, 153, 0.10);
    --diffs-bg-addition-hover-override: rgba(52, 211, 153, 0.10);
    --diffs-bg-addition-emphasis-override: rgba(52, 211, 153, 0.20);
  }
`;

export function ChangesTab({ tab }: TabContentProps) {
  const workspace = useActiveWorkspace();
  const filePath = tab.metadata?.filePath as string;
  const staged = tab.metadata?.staged as boolean;
  const isUntracked = tab.metadata?.isUntracked as boolean;

  const [patch, setPatch] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!workspace?.path || !filePath) return;

    let cancelled = false;

    async function loadDiff() {
      try {
        let result: string;
        if (isUntracked) {
          result = await invoke<string>("git_diff_untracked", {
            path: workspace!.path,
            file: filePath,
          });
        } else {
          result = await invoke<string>("git_diff", {
            path: workspace!.path,
            file: filePath,
            staged: staged ?? false,
          });
        }
        if (!cancelled) {
          setPatch(result || "");
          setError(null);
        }
      } catch (e) {
        if (!cancelled) {
          setError(String(e));
          setPatch(null);
        }
      }
    }

    loadDiff();
    return () => {
      cancelled = true;
    };
  }, [workspace?.path, filePath, staged, isUntracked]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-[var(--color-status-red)]">{error}</p>
      </div>
    );
  }

  if (patch === null) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-[var(--color-text-secondary)]">Loading diff...</p>
      </div>
    );
  }

  if (patch === "") {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-[var(--color-text-muted)]">No changes</p>
      </div>
    );
  }

  return (
    <OverlayScrollbarsComponent
      className="h-full changes-tab-container"
      options={{
        scrollbars: {
          autoHide: "scroll",
          autoHideDelay: 800,
          theme: "os-theme-custom",
        },
        overflow: { x: "scroll", y: "scroll" },
      }}
    >
      <PatchDiff
        patch={patch}
        options={{
          theme: "cosmos-dark",
          themeType: "dark",
          diffStyle: "unified",
          disableFileHeader: true,
          disableLineNumbers: false,
          overflow: "wrap",
          unsafeCSS: THEME_CSS,
        }}
      />
    </OverlayScrollbarsComponent>
  );
}
