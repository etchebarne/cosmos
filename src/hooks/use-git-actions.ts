import { useState, useMemo, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";

type GitAction = "fetch" | "pull" | "pull_rebase" | "push" | "force_push";

const GIT_ACTIONS: { key: GitAction; label: string; command: string }[] = [
  { key: "fetch", label: "Fetch", command: "git_fetch" },
  { key: "pull", label: "Pull", command: "git_pull" },
  { key: "pull_rebase", label: "Pull (Rebase)", command: "git_pull_rebase" },
  { key: "push", label: "Push", command: "git_push" },
  { key: "force_push", label: "Force Push", command: "git_force_push" },
];

export { GIT_ACTIONS };
export type { GitAction };

export function useGitActions(
  workspacePath: string | null,
  refresh: () => void,
  setError: (error: string | null) => void,
) {
  const [activeAction, setActiveAction] = useState<GitAction>("fetch");
  const [actionRunning, setActionRunning] = useState(false);
  const [actionDone, setActionDone] = useState(false);

  const currentAction = useMemo(
    () => GIT_ACTIONS.find((a) => a.key === activeAction)!,
    [activeAction],
  );

  const handleRunAction = useCallback(
    async (action?: GitAction) => {
      if (!workspacePath || actionRunning) return;
      const act = GIT_ACTIONS.find((a) => a.key === (action ?? activeAction))!;
      if (action) setActiveAction(action);
      setActionRunning(true);
      try {
        await invoke(act.command, { path: workspacePath });
        refresh();
        setActionDone(true);
        setTimeout(() => setActionDone(false), 2000);
      } catch (e) {
        setError(String(e));
      } finally {
        setActionRunning(false);
      }
    },
    [workspacePath, refresh, actionRunning, activeAction, setError],
  );

  return {
    activeAction,
    setActiveAction,
    actionRunning,
    actionDone,
    currentAction,
    handleRunAction,
  };
}
