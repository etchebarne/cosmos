import { useState, useCallback } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon, Add01Icon } from "@hugeicons/core-free-icons";
import { open } from "@tauri-apps/plugin-dialog";
import { getTheme } from "../../lib/themes";
import { useWorkspaceStore } from "../../store/workspace.store";
import { ContextMenu } from "../shared/ContextMenu";
import { Tooltip } from "../shared/Tooltip";

export function ProjectBar() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeIndex = useWorkspaceStore((s) => s.activeIndex);
  const openWorkspace = useWorkspaceStore((s) => s.openWorkspace);
  const switchWorkspace = useWorkspaceStore((s) => s.switchWorkspace);
  const closeWorkspace = useWorkspaceStore((s) => s.closeWorkspace);

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    index: number;
  } | null>(null);

  const handleContextMenu = useCallback((e: React.MouseEvent, index: number) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, index });
  }, []);

  const handleCloseMenu = useCallback(() => setContextMenu(null), []);

  const active = activeIndex !== null ? workspaces[activeIndex] : null;

  const handleOpenFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      await openWorkspace(selected);
    }
  };

  return (
    <div className="flex items-center gap-2 h-[52px] min-h-[52px] px-3 bg-[var(--color-project-bar-bg)] border-b border-[var(--color-border-primary)]">
      {active && (
        <span className="text-xs font-medium text-[var(--color-text-secondary)]">
          {active.name}
        </span>
      )}
      <div className="flex-1" />
      <div className="flex items-center gap-1.5 w-[220px] h-8 px-2.5 bg-[var(--color-bg-input)]">
        <HugeiconsIcon
          icon={Search01Icon}
          size={13}
          className="text-[var(--color-text-muted)] shrink-0"
        />
        <span className="text-xs text-[var(--color-text-muted)]">Search files...</span>
        <div className="flex-1" />
      </div>
      {workspaces.map((w, i) => {
        const isActive = i === activeIndex;
        return (
          <Tooltip key={w.path} content={w.name}>
            <button
              className="font-mono w-8 h-8 flex items-center justify-center text-[13px] font-bold shrink-0 hover:opacity-85"
              style={{
                backgroundColor: isActive ? w.color : `${w.color}40`,
                color: isActive ? getTheme().terminal.brightWhite : w.color,
              }}
              onClick={() => switchWorkspace(i)}
              onContextMenu={(e) => handleContextMenu(e, i)}
            >
              {w.name[0].toUpperCase()}
            </button>
          </Tooltip>
        );
      })}
      <button
        className="w-8 h-8 flex items-center justify-center border border-[var(--color-border-secondary)] text-[var(--color-text-muted)] shrink-0 hover:border-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
        onClick={handleOpenFolder}
      >
        <HugeiconsIcon icon={Add01Icon} size={14} />
      </button>

      {contextMenu && (
        <ContextMenu
          x={contextMenu.x}
          y={contextMenu.y}
          items={[
            {
              label: "Close",
              onClick: () => closeWorkspace(contextMenu.index),
            },
          ]}
          onClose={handleCloseMenu}
        />
      )}
    </div>
  );
}
