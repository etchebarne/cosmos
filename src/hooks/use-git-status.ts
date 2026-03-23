import { useState, useCallback, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import type { GitStatusInfo } from "../lib/git-tree";

export function useGitStatus(workspacePath: string | null, active = true) {
  const [status, setStatus] = useState<GitStatusInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!workspacePath) return;
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<GitStatusInfo>("get_git_status", {
        path: workspacePath,
      });
      setStatus(result);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [workspacePath]);

  // Fetch on mount/active-change and watch for file changes while active
  useEffect(() => {
    if (!workspacePath || !active) return;

    refresh();

    invoke("watch_workspace", { path: workspacePath });

    const unlisten = listen("git-changed", () => {
      refresh();
    });

    return () => {
      unlisten.then((fn) => fn());
      invoke("unwatch_workspace", { path: workspacePath });
    };
  }, [workspacePath, refresh, active]);

  return { status, loading, error, setError, refresh };
}
