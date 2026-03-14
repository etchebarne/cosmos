import { useEffect, useRef, useState, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { useActiveWorkspace } from "../../contexts/WorkspaceContext";
import { TabIcon } from "../../components/shared/TabIcon";
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

    const terminal = new Terminal({
      fontSize: DEFAULT_FONT_SIZE,
      fontFamily: "'Cascadia Code', 'Consolas', 'Courier New', monospace",
      cursorBlink: true,
      theme: {
        background: "#111116",
        foreground: "#e8e8ed",
        cursor: "#e8e8ed",
        cursorAccent: "#111116",
        selectionBackground: "rgba(255, 255, 255, 0.15)",
        black: "#000000",
        red: "#f87171",
        green: "#34d399",
        yellow: "#fbbf24",
        blue: "#4b8ef5",
        magenta: "#c678dd",
        cyan: "#56b6c2",
        white: "#e8e8ed",
        brightBlack: "#6b6b78",
        brightRed: "#f87171",
        brightGreen: "#34d399",
        brightYellow: "#fbbf24",
        brightBlue: "#5e9df7",
        brightMagenta: "#c678dd",
        brightCyan: "#56b6c2",
        brightWhite: "#ffffff",
      },
    });

    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    // Intercept zoom shortcuts before they reach the PTY
    terminal.attachCustomKeyEventHandler((e) => {
      if (e.type !== "keydown" || !e.ctrlKey) return true;
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
    fitAddon.fit();

    let disposed = false;
    const cleanups: (() => void)[] = [];

    (async () => {
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
        invoke("terminal_write", { id: terminalId, data });
      });
      cleanups.push(() => onData.dispose());

      // Resize handling
      const observer = new ResizeObserver(() => {
        fitAddon.fit();
        invoke("terminal_resize", {
          id: terminalId,
          cols: terminal.cols,
          rows: terminal.rows,
        });
      });
      observer.observe(el);
      cleanups.push(() => observer.disconnect());
    })();

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
    invoke<ShellInfo[]>("terminal_list_shells").then((s) => {
      setShells(s);
      setLoading(false);
    });
  }, []);

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
