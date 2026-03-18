import { useState, useCallback, useEffect, useRef } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon, Add01Icon, ComputerIcon, CloudServerIcon } from "@hugeicons/core-free-icons";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { getTheme } from "../../lib/themes";
import { useWorkspaceStore } from "../../store/workspace.store";
import { ContextMenu, type ContextMenuItem } from "../shared/ContextMenu";
import { Tooltip } from "../shared/Tooltip";
import { RemoteDialog } from "./RemoteDialog";

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

  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
  const [wslDistros, setWslDistros] = useState<string[]>([]);
  const [remoteDialog, setRemoteDialog] = useState<string | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  // Fetch WSL distros once
  useEffect(() => {
    invoke<string[]>("list_wsl_distros")
      .then(setWslDistros)
      .catch((e) => console.warn("Failed to list WSL distros:", e));
  }, []);

  const handleContextMenu = useCallback((e: React.MouseEvent, index: number) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY, index });
  }, []);

  const handleCloseMenu = useCallback(() => setContextMenu(null), []);
  const handleCloseAddMenu = useCallback(() => setAddMenu(null), []);

  const active = activeIndex !== null ? workspaces[activeIndex] : null;

  const handleOpenFolder = async () => {
    const selected = await open({ directory: true, multiple: false });
    if (selected) {
      await openWorkspace(selected);
    }
  };

  const handleAddClick = useCallback(
    (_e: React.MouseEvent) => {
      if (wslDistros.length === 0) {
        // No WSL distros — just open folder directly
        handleOpenFolder();
        return;
      }

      // Show menu with local + WSL options
      const rect = addButtonRef.current?.getBoundingClientRect();
      if (rect) {
        setAddMenu({ x: rect.left, y: rect.bottom + 4 });
      }
    },
    [wslDistros],
  );

  const addMenuItems: ContextMenuItem[] = [
    {
      label: "Open Local Folder",
      onClick: () => handleOpenFolder(),
    },
    { separator: true },
    ...wslDistros.map((distro) => ({
      label: `WSL: ${distro}`,
      onClick: () => setRemoteDialog(distro),
    })),
  ];

  return (
    <div className="flex items-center gap-2 h-[52px] min-h-[52px] px-3 bg-[var(--color-project-bar-bg)] border-b border-[var(--color-border-primary)]">
      {active && (
        <div className="flex items-center gap-1.5">
          {active.connection && active.connection.type !== "local" && (
            <Tooltip
              content={
                active.connection.type === "wsl"
                  ? `WSL: ${active.connection.distro}`
                  : active.connection.type === "ssh"
                    ? `SSH: ${active.connection.host}`
                    : ""
              }
            >
              <div className="flex items-center justify-center text-[var(--color-accent-blue)]">
                <HugeiconsIcon
                  icon={active.connection.type === "wsl" ? ComputerIcon : CloudServerIcon}
                  size={14}
                />
              </div>
            </Tooltip>
          )}
          <span className="text-xs font-medium text-[var(--color-text-secondary)]">
            {active.name}
          </span>
        </div>
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
          <Tooltip
            key={w.path}
            content={
              w.connection && w.connection.type !== "local"
                ? `${w.name} [${w.connection.type === "wsl" ? `WSL: ${w.connection.distro}` : w.connection.type === "ssh" ? `SSH: ${w.connection.host}` : ""}]`
                : w.name
            }
          >
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
        ref={addButtonRef}
        className="w-8 h-8 flex items-center justify-center border border-[var(--color-border-secondary)] text-[var(--color-text-muted)] shrink-0 hover:border-[var(--color-text-tertiary)] hover:text-[var(--color-text-secondary)]"
        onClick={handleAddClick}
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

      {addMenu && (
        <ContextMenu
          x={addMenu.x}
          y={addMenu.y}
          items={addMenuItems}
          onClose={handleCloseAddMenu}
        />
      )}

      {remoteDialog && (
        <RemoteDialog open distro={remoteDialog} onClose={() => setRemoteDialog(null)} />
      )}
    </div>
  );
}
