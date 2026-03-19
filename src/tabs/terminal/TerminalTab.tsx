import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { readText } from "@tauri-apps/plugin-clipboard-manager";
import { useActiveWorkspace } from "../../contexts/WorkspaceContext";
import { TabIcon } from "../../components/shared/TabIcon";
import { getTheme } from "../../lib/themes";
import type { TabContentProps } from "../types";
import "@xterm/xterm/css/xterm.css";

interface ShellInfo {
  name: string;
  program: string;
  args: string[];
}

function ShellPicker({
  shells,
  loading,
  onSelect,
}: {
  shells: ShellInfo[];
  loading: boolean;
  onSelect: (shell: ShellInfo) => void;
}) {
  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-[var(--color-text-secondary)]">Detecting shells...</p>
      </div>
    );
  }

  return (
    <div className="@container flex flex-col items-center justify-center h-full gap-6 p-4">
      <div className="flex flex-col items-center gap-2">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Terminal</h3>
        <p className="text-xs text-[var(--color-text-secondary)]">Select a shell to start</p>
      </div>
      {shells.length === 0 ? (
        <p className="text-xs text-[var(--color-text-muted)]">No shells found</p>
      ) : (
        <div className="grid grid-cols-1 @[360px]:grid-cols-2 gap-2 w-full @[360px]:w-[320px]">
          {shells.map((shell, i) => (
            <button
              key={`${shell.program}-${i}`}
              className="flex items-center gap-3 px-3 py-2.5 bg-[var(--color-bg-surface)] border border-[var(--color-border-secondary)] text-left hover:border-[var(--color-accent-blue)] hover:bg-[var(--color-bg-hover)] transition-colors"
              onClick={() => onSelect(shell)}
            >
              <TabIcon
                name="terminal"
                size={16}
                className="shrink-0 text-[var(--color-text-tertiary)]"
              />
              <span className="text-xs text-[var(--color-text-primary)]">{shell.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

let spawnCounter = 0;

function TerminalView({ tabId, shell, cwd }: { tabId: string; shell: ShellInfo; cwd: string }) {
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    // Unique ID per effect invocation to avoid Strict Mode race conditions
    const terminalId = `${tabId}-${++spawnCounter}`;

    const DEFAULT_FONT_SIZE = 13;
    const MIN_FONT_SIZE = 8;
    const MAX_FONT_SIZE = 30;

    const t = getTheme().terminal;
    const terminal = new Terminal({
      fontSize: DEFAULT_FONT_SIZE,
      fontFamily: "'Cascadia Code', 'Consolas', 'Courier New', monospace",
      cursorBlink: true,
      theme: {
        background: t.background,
        foreground: t.foreground,
        cursor: t.cursor,
        cursorAccent: t.cursorAccent,
        selectionBackground: t.selection,
        black: t.black,
        red: t.red,
        green: t.green,
        yellow: t.yellow,
        blue: t.blue,
        magenta: t.magenta,
        cyan: t.cyan,
        white: t.white,
        brightBlack: t.brightBlack,
        brightRed: t.brightRed,
        brightGreen: t.brightGreen,
        brightYellow: t.brightYellow,
        brightBlue: t.brightBlue,
        brightMagenta: t.brightMagenta,
        brightCyan: t.brightCyan,
        brightWhite: t.brightWhite,
      },
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    // Intercept shortcuts before they reach the PTY
    terminal.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown" || !e.ctrlKey) return true;
      // Ctrl+C: copy selection if any, otherwise send SIGINT (like Windows Terminal)
      if (!e.shiftKey && e.key === "c") {
        if (terminal.hasSelection()) {
          e.preventDefault();
          navigator.clipboard.writeText(terminal.getSelection());
          terminal.clearSelection();
          return false;
        }
        return true;
      }
      // Ctrl+Shift+V or Ctrl+V: paste
      if (e.key === "V" || e.key === "v") {
        e.preventDefault();
        readText()
          .then((text) => {
            if (text) invoke("terminal_write", { id: terminalId, data: text });
          })
          .catch(() => {});
        return false;
      }
      if (e.key === "=" || e.key === "+") {
        e.preventDefault();
        const next = Math.min(terminal.options.fontSize! + 1, MAX_FONT_SIZE);
        terminal.options.fontSize = next;
        fitAddon.fit();
        return false;
      }
      if (e.key === "-") {
        e.preventDefault();
        const next = Math.max(terminal.options.fontSize! - 1, MIN_FONT_SIZE);
        terminal.options.fontSize = next;
        fitAddon.fit();
        return false;
      }
      if (e.key === "0") {
        e.preventDefault();
        terminal.options.fontSize = DEFAULT_FONT_SIZE;
        fitAddon.fit();
        return false;
      }
      return true;
    });

    terminal.open(el);

    let disposed = false;
    let spawned = false;
    const cleanups: (() => void)[] = [];

    // Resize handling — registered immediately so no resize is missed
    let resizeTimeout: ReturnType<typeof setTimeout>;
    const observer = new ResizeObserver(() => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        // Skip resize when the container is hidden (e.g. workspace switched
        // away). display:none collapses the element to 0×0; fitting then
        // would send a bogus tiny resize to the PTY, corrupting TUI apps.
        if (!el.offsetWidth && !el.offsetHeight) return;

        fitAddon.fit();
        if (spawned) {
          invoke("terminal_resize", {
            id: terminalId,
            cols: terminal.cols,
            rows: terminal.rows,
          });
        }
      }, 150);
    });
    observer.observe(el);
    cleanups.push(() => {
      clearTimeout(resizeTimeout);
      observer.disconnect();
    });

    // Update xterm colors when the app theme changes
    const onThemeChanged = () => {
      const nt = getTheme().terminal;
      terminal.options.theme = {
        background: nt.background,
        foreground: nt.foreground,
        cursor: nt.cursor,
        cursorAccent: nt.cursorAccent,
        selectionBackground: nt.selection,
        black: nt.black,
        red: nt.red,
        green: nt.green,
        yellow: nt.yellow,
        blue: nt.blue,
        magenta: nt.magenta,
        cyan: nt.cyan,
        white: nt.white,
        brightBlack: nt.brightBlack,
        brightRed: nt.brightRed,
        brightGreen: nt.brightGreen,
        brightYellow: nt.brightYellow,
        brightBlue: nt.brightBlue,
        brightMagenta: nt.brightMagenta,
        brightCyan: nt.brightCyan,
        brightWhite: nt.brightWhite,
      };
    };
    window.addEventListener("theme-changed", onThemeChanged);
    cleanups.push(() => window.removeEventListener("theme-changed", onThemeChanged));

    // Wait for layout to settle before fitting and spawning the shell.
    // Two rAFs: first enters the next frame, second ensures layout is
    // computed — this guarantees the container has its final dimensions.
    requestAnimationFrame(() => {
      requestAnimationFrame(async () => {
        if (disposed) return;

        fitAddon.fit();

        try {
          await invoke("terminal_spawn", {
            id: terminalId,
            program: shell.program,
            args: shell.args,
            cwd,
            cols: terminal.cols,
            rows: terminal.rows,
          });
        } catch (e) {
          terminal.write(`\x1b[31mFailed to start shell: ${e}\x1b[0m\r\n`);
          return;
        }

        if (disposed) {
          invoke("terminal_close", { id: terminalId });
          return;
        }

        spawned = true;

        // Terminal output → xterm
        const unlisten = await listen<string>(`terminal-data-${terminalId}`, (event) => {
          terminal.write(event.payload);
        });
        cleanups.push(unlisten);

        const unlistenExit = await listen(`terminal-exit-${terminalId}`, () => {
          terminal.write("\r\n\x1b[90m[Process exited]\x1b[0m\r\n");
        });
        cleanups.push(unlistenExit);

        // Keyboard input → PTY
        const onData = terminal.onData((data) => {
          invoke("terminal_write", { id: terminalId, data }).catch(() => {
            terminal.write("\r\n\x1b[31m[Connection lost]\x1b[0m\r\n");
          });
        });
        cleanups.push(() => onData.dispose());
      });
    });

    return () => {
      disposed = true;
      cleanups.forEach((fn) => fn());
      terminal.dispose();
      invoke("terminal_close", { id: terminalId });
    };
  }, [tabId, shell, cwd]);

  return <div ref={containerRef} className="w-full h-full overflow-hidden" />;
}

export function TerminalTab({ tab }: TabContentProps) {
  const workspace = useActiveWorkspace();
  const [selectedShell, setSelectedShell] = useState<ShellInfo | null>(null);
  const [shells, setShells] = useState<ShellInfo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    invoke<ShellInfo[]>("terminal_list_shells", {
      workspacePath: workspace?.path ?? null,
    }).then((s) => {
      setShells(s);
      setLoading(false);
    });
  }, [workspace?.path]);

  const handleSelect = useCallback((shell: ShellInfo) => {
    setSelectedShell(shell);
  }, []);

  if (!workspace) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-[var(--color-text-muted)]">No workspace open</p>
      </div>
    );
  }

  if (!selectedShell) {
    return <ShellPicker shells={shells} loading={loading} onSelect={handleSelect} />;
  }

  return <TerminalView tabId={tab.id} shell={selectedShell} cwd={workspace.path} />;
}
