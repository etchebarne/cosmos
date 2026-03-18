import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { OverlayScrollbarsComponent } from "overlayscrollbars-react";
import { Dialog } from "../shared/Dialog";
import { ScrollArea } from "../shared/ScrollArea";
import { useWorkspaceStore } from "../../store/workspace.store";

interface RemoteDialogProps {
  open: boolean;
  onClose: () => void;
  distro: string;
}

interface DirEntry {
  name: string;
  is_dir: boolean;
}

export function RemoteDialog({ open, onClose, distro }: RemoteDialogProps) {
  const openWorkspace = useWorkspaceStore((s) => s.openWorkspace);
  const [cwd, setCwd] = useState("/");
  const [entries, setEntries] = useState<DirEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);

  // Resolve home dir on open
  useEffect(() => {
    if (!open) return;
    setStatus(null);
    setConnecting(false);
    setError(null);
    invoke<string>("wsl_resolve_home", { distro })
      .then((home) => {
        setCwd(home);
      })
      .catch(() => {
        setCwd("/");
      });
  }, [open, distro]);

  // Fetch directory listing when cwd changes
  useEffect(() => {
    if (!open || !cwd) return;
    setLoading(true);
    setError(null);
    invoke<DirEntry[]>("wsl_list_dir", { distro, path: cwd })
      .then((result) => {
        setEntries(result);
        setLoading(false);
      })
      .catch((e) => {
        setError(String(e));
        setEntries([]);
        setLoading(false);
      });
  }, [open, distro, cwd]);

  const navigate = useCallback(
    (name: string) => {
      const next = cwd === "/" ? `/${name}` : `${cwd}/${name}`;
      setCwd(next);
    },
    [cwd],
  );

  const navigateUp = useCallback(() => {
    if (cwd === "/") return;
    // Remove trailing slash before finding parent
    const normalized = cwd.endsWith("/") ? cwd.slice(0, -1) : cwd;
    const parent = normalized.substring(0, normalized.lastIndexOf("/")) || "/";
    setCwd(parent);
  }, [cwd]);

  const navigateBreadcrumb = useCallback(
    (index: number) => {
      // index 0 = "/", index 1 = first segment, etc.
      if (index === 0) {
        setCwd("/");
        return;
      }
      const segments = cwd.split("/").filter(Boolean);
      const path = "/" + segments.slice(0, index).join("/");
      setCwd(path);
    },
    [cwd],
  );

  const handleConnect = useCallback(async () => {
    setConnecting(true);
    setStatus("Deploying agent...");

    try {
      try {
        await invoke("deploy_agent_wsl", { distro });
      } catch (e) {
        setStatus(`Agent deploy failed: ${e}`);
        setConnecting(false);
        return;
      }

      setStatus("Connecting...");

      await invoke("remote_connect", {
        workspacePath: `wsl://${distro}${cwd}`,
        connection: { type: "wsl", distro },
      });

      await openWorkspace(`wsl://${distro}${cwd}`, {
        type: "wsl",
        distro,
      });

      onClose();
    } catch (e) {
      setStatus(`Connection failed: ${e}`);
      setConnecting(false);
    }
  }, [cwd, distro, openWorkspace, onClose]);

  const segments = cwd.split("/").filter(Boolean);
  const dirs = entries.filter((e) => e.is_dir);

  return (
    <Dialog open={open} onClose={onClose} title={`Connect to WSL: ${distro}`}>
      <div className="flex flex-col" style={{ height: 380 }}>
        {/* Breadcrumb path bar */}
        <OverlayScrollbarsComponent
          className="border-b border-[var(--color-border-primary)] bg-[var(--color-bg-input)] min-h-[36px] shrink-0"
          options={{
            scrollbars: {
              autoHide: "scroll",
              autoHideDelay: 800,
              theme: "os-theme-custom",
            },
            overflow: { x: "scroll", y: "hidden" },
          }}
        >
          <div className="flex items-center gap-0.5 px-3 py-2 w-max">
            <button
              className="text-xs px-1 py-0.5 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-bg-hover)] shrink-0"
              onClick={() => navigateBreadcrumb(0)}
            >
              /
            </button>
            {segments.map((seg, i) => (
              <span key={i} className="flex items-center shrink-0">
                <span className="text-[10px] text-[var(--color-text-muted)]">/</span>
                <button
                  className={`text-xs px-1 py-0.5 hover:bg-[var(--color-bg-hover)] ${
                    i === segments.length - 1
                      ? "text-[var(--color-text-primary)] font-medium"
                      : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
                  }`}
                  onClick={() => navigateBreadcrumb(i + 1)}
                >
                  {seg}
                </button>
              </span>
            ))}
          </div>
        </OverlayScrollbarsComponent>

        {/* Directory listing */}
        <ScrollArea className="flex-1">
          {loading ? (
            <div className="flex items-center justify-center h-full">
              <span className="text-xs text-[var(--color-text-muted)]">Loading...</span>
            </div>
          ) : error ? (
            <div className="flex items-center justify-center h-full px-4">
              <span className="text-xs text-[var(--color-status-red)]">{error}</span>
            </div>
          ) : (
            <div className="flex flex-col">
              {/* Go up */}
              {cwd !== "/" && (
                <button
                  className="flex items-center gap-2.5 px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] text-left"
                  onClick={navigateUp}
                >
                  <span className="w-4 text-center text-[var(--color-text-muted)]">..</span>
                  <span>..</span>
                </button>
              )}
              {dirs.map((entry) => (
                <button
                  key={entry.name}
                  className="flex items-center gap-2.5 px-3 py-1.5 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-hover)] hover:text-[var(--color-text-primary)] text-left"
                  onClick={() => navigate(entry.name)}
                >
                  <svg
                    width="14"
                    height="14"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                    className="shrink-0 text-[var(--color-text-muted)]"
                  >
                    <path d="M1.5 2A1.5 1.5 0 000 3.5v9A1.5 1.5 0 001.5 14h13a1.5 1.5 0 001.5-1.5V5a1.5 1.5 0 00-1.5-1.5H7.707l-1.354-1.354A.5.5 0 006 2H1.5z" />
                  </svg>
                  <span>{entry.name}</span>
                </button>
              ))}
              {dirs.length === 0 && cwd === "/" && (
                <div className="px-3 py-4 text-xs text-[var(--color-text-muted)] text-center">
                  No subdirectories
                </div>
              )}
            </div>
          )}
        </ScrollArea>

        {/* Footer */}
        <div className="flex items-center justify-between gap-3 px-3 py-2.5 border-t border-[var(--color-border-primary)] shrink-0">
          <span className="text-[11px] text-[var(--color-text-muted)] truncate flex-1 min-w-0">
            {status ?? cwd}
          </span>
          <div className="flex gap-2 shrink-0">
            <button
              className="h-7 px-3 text-xs text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] border border-[var(--color-border-secondary)] hover:border-[var(--color-border-primary)]"
              onClick={onClose}
              disabled={connecting}
            >
              Cancel
            </button>
            <button
              className="h-7 px-3 text-xs text-white bg-[var(--color-accent-blue)] hover:bg-[var(--color-accent-blue-hover)] disabled:opacity-50"
              onClick={handleConnect}
              disabled={connecting}
            >
              {connecting ? "Connecting..." : "Open"}
            </button>
          </div>
        </div>
      </div>
    </Dialog>
  );
}
