import { useState, useCallback, useEffect, useRef, useLayoutEffect } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import { Search01Icon, Add01Icon, ComputerIcon, CloudServerIcon } from "@hugeicons/core-free-icons";
import { open } from "@tauri-apps/plugin-dialog";
import { invoke } from "@tauri-apps/api/core";
import { getTheme } from "../../lib/themes";
import { useWorkspaceStore } from "../../store/workspace.store";
import { ContextMenu, type ContextMenuItem } from "../shared/ContextMenu";
import { Tooltip } from "../shared/Tooltip";
import { RemoteDialog } from "./RemoteDialog";

const DRAG_THRESHOLD = 5;
const FLIP_DURATION = 150;

export function ProjectBar() {
  const workspaces = useWorkspaceStore((s) => s.workspaces);
  const activeIndex = useWorkspaceStore((s) => s.activeIndex);
  const openWorkspace = useWorkspaceStore((s) => s.openWorkspace);
  const switchWorkspace = useWorkspaceStore((s) => s.switchWorkspace);
  const closeWorkspace = useWorkspaceStore((s) => s.closeWorkspace);
  const reorderWorkspace = useWorkspaceStore((s) => s.reorderWorkspace);

  const [dragPath, setDragPath] = useState<string | null>(null);
  const isDraggingRef = useRef(false);
  const currentIndexRef = useRef<number>(0);
  const swapXRef = useRef<number | null>(null);
  const workspaceBtnRefs = useRef<Map<string, HTMLButtonElement>>(new Map());
  // Snapshot of button positions taken right before a reorder
  const positionsRef = useRef<Map<string, number>>(new Map());

  const [contextMenu, setContextMenu] = useState<{
    x: number;
    y: number;
    index: number;
  } | null>(null);

  const [addMenu, setAddMenu] = useState<{ x: number; y: number } | null>(null);
  const [wslDistros, setWslDistros] = useState<string[]>([]);
  const [remoteDialog, setRemoteDialog] = useState<string | null>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  // FLIP animation: after React re-renders with new order, animate from old positions
  useLayoutEffect(() => {
    if (positionsRef.current.size === 0) return;
    const oldPositions = positionsRef.current;
    positionsRef.current = new Map();

    workspaceBtnRefs.current.forEach((el, path) => {
      const oldX = oldPositions.get(path);
      if (oldX === undefined) return;
      const newX = el.getBoundingClientRect().left;
      const deltaX = oldX - newX;
      if (Math.abs(deltaX) < 1) return;

      // Invert: jump to old position
      el.style.transition = "none";
      el.style.transform = `translateX(${deltaX}px)`;
      // Play: animate to new position
      requestAnimationFrame(() => {
        el.style.transition = `transform ${FLIP_DURATION}ms cubic-bezier(0.16, 1, 0.3, 1)`;
        el.style.transform = "";
      });
    });
  }, [workspaces]);

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

  const getDropIndex = useCallback((clientX: number) => {
    const refs = workspaceBtnRefs.current;
    const entries = Array.from(refs.entries());
    const state = useWorkspaceStore.getState();
    // Sort entries by current workspace order
    entries.sort((a, b) => {
      const ai = state.workspaces.findIndex((w) => w.path === a[0]);
      const bi = state.workspaces.findIndex((w) => w.path === b[0]);
      return ai - bi;
    });
    for (let i = 0; i < entries.length; i++) {
      const el = entries[i][1];
      const rect = el.getBoundingClientRect();
      const mid = rect.left + rect.width / 2;
      if (clientX < mid) return i;
    }
    return entries.length - 1;
  }, []);

  /** Snapshot all button positions before triggering a reorder. */
  const snapshotPositions = useCallback(() => {
    const snap = new Map<string, number>();
    workspaceBtnRefs.current.forEach((el, path) => {
      snap.set(path, el.getBoundingClientRect().left);
    });
    positionsRef.current = snap;
  }, []);

  const handleWorkspaceMouseDown = useCallback(
    (e: React.MouseEvent, index: number) => {
      if (e.button !== 0) return;
      e.preventDefault();

      const startX = e.clientX;
      const startY = e.clientY;
      isDraggingRef.current = false;
      currentIndexRef.current = index;
      const path = useWorkspaceStore.getState().workspaces[index]?.path;

      const SWAP_DEAD_ZONE = 16;

      const onMouseMove = (ev: MouseEvent) => {
        const dx = ev.clientX - startX;
        const dy = ev.clientY - startY;
        if (!isDraggingRef.current && Math.sqrt(dx * dx + dy * dy) > DRAG_THRESHOLD) {
          isDraggingRef.current = true;
          setDragPath(path);
        }
        if (isDraggingRef.current) {
          // After a swap, require the cursor to move past a dead zone before allowing another
          if (
            swapXRef.current !== null &&
            Math.abs(ev.clientX - swapXRef.current) < SWAP_DEAD_ZONE
          ) {
            return;
          }
          const targetIndex = getDropIndex(ev.clientX);
          if (targetIndex !== currentIndexRef.current) {
            snapshotPositions();
            reorderWorkspace(currentIndexRef.current, targetIndex);
            currentIndexRef.current = targetIndex;
            swapXRef.current = ev.clientX;
          }
        }
      };

      const onMouseUp = () => {
        if (!isDraggingRef.current) {
          switchWorkspace(index);
        }
        isDraggingRef.current = false;
        swapXRef.current = null;
        setDragPath(null);
        document.removeEventListener("mousemove", onMouseMove);
        document.removeEventListener("mouseup", onMouseUp);
      };

      document.addEventListener("mousemove", onMouseMove);
      document.addEventListener("mouseup", onMouseUp);
    },
    [getDropIndex, snapshotPositions, reorderWorkspace, switchWorkspace],
  );

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
      <div className="flex items-center gap-2">
        {workspaces.map((w, i) => {
          const isActive = i === activeIndex;
          const isDragged = dragPath === w.path;
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
                ref={(el) => {
                  if (el) {
                    workspaceBtnRefs.current.set(w.path, el);
                  } else {
                    workspaceBtnRefs.current.delete(w.path);
                  }
                }}
                draggable={false}
                className="font-mono w-8 h-8 flex items-center justify-center text-[13px] font-bold shrink-0 hover:opacity-85 overflow-hidden select-none"
                style={{
                  backgroundColor: w.avatarUrl ? undefined : isActive ? w.color : `${w.color}40`,
                  color: isActive ? getTheme().terminal.brightWhite : w.color,
                  opacity: isDragged ? 0.5 : w.avatarUrl && !isActive ? 0.4 : undefined,
                  cursor: dragPath !== null ? "grabbing" : "pointer",
                }}
                onMouseDown={(e) => handleWorkspaceMouseDown(e, i)}
                onContextMenu={(e) => handleContextMenu(e, i)}
              >
                {w.avatarUrl ? (
                  <img
                    src={w.avatarUrl}
                    alt={w.name}
                    draggable={false}
                    className="w-full h-full object-cover pointer-events-none"
                    onError={(e) => {
                      // Hide broken image, show fallback letter
                      (e.target as HTMLImageElement).style.display = "none";
                    }}
                  />
                ) : (
                  w.name[0].toUpperCase()
                )}
              </button>
            </Tooltip>
          );
        })}
      </div>
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
