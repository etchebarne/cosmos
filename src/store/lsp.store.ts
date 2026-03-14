import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Monaco } from "@monaco-editor/react";
import type { IDisposable } from "monaco-editor";
import { TauriLspTransport } from "../lib/lsp/transport";
import { LspClient } from "../lib/lsp/client";
import { registerLspProviders } from "../lib/lsp/monaco-bridge";
import { useToastStore } from "./toast.store";

export type ServerStatus =
  | "starting"
  | "running"
  | "stopped"
  | "error"
  | "unavailable"
  | "installing";

export interface ServerAvailability {
  language_id: string;
  server_name: string;
  available: boolean;
}

export interface LspServerInfo {
  serverId: string;
  languageId: string;
  client: LspClient;
  status: ServerStatus;
  serverName: string;
  errorMessage: string | null;
  providerDisposables: IDisposable[];
}

interface LspState {
  // workspace path -> language -> server info
  servers: Record<string, Record<string, LspServerInfo>>;
  // workspace path -> availability info
  availability: Record<string, ServerAvailability[]>;

  startServer: (
    workspacePath: string,
    languageId: string,
    monaco: Monaco,
  ) => Promise<LspClient | null>;
  getClient: (workspacePath: string, languageId: string) => LspClient | null;
  stopWorkspace: (workspacePath: string) => Promise<void>;
  checkAvailability: (workspacePath: string) => Promise<void>;
  installServer: (workspacePath: string, serverName: string) => Promise<void>;
}

// Store monaco instance for restarting servers after install
let monacoRef: Monaco | null = null;

// Track in-flight startServer calls to prevent duplicates
const pending = new Set<string>();

// Map Monaco language IDs to the server-level language group.
// Must match backend's server_language_group() in detection.rs.
export function resolveServerLanguage(languageId: string): string {
  switch (languageId) {
    case "javascript":
    case "typescriptreact":
    case "javascriptreact":
      return "typescript";
    case "cpp":
      return "c";
    case "scss":
    case "less":
      return "css";
    case "jsonc":
      return "json";
    default:
      return languageId;
  }
}

// Get all Monaco language IDs that a server handles
function getMonacoLanguages(serverLanguage: string): string[] {
  switch (serverLanguage) {
    case "typescript":
      return ["typescript", "javascript", "typescriptreact", "javascriptreact"];
    case "c":
      return ["c", "cpp"];
    case "css":
      return ["css", "scss", "less"];
    case "json":
      return ["json", "jsonc"];
    default:
      return [serverLanguage];
  }
}

export const useLspStore = create<LspState>((set, get) => ({
  servers: {},
  availability: {},

  checkAvailability: async (workspacePath) => {
    try {
      const result = await invoke<ServerAvailability[]>("lsp_check_availability", {
        workspacePath,
      });
      set((state) => ({
        availability: {
          ...state.availability,
          [workspacePath]: result,
        },
      }));
    } catch (err) {
      console.error("Failed to check LSP availability:", err);
    }
  },

  startServer: async (workspacePath, languageId, monaco) => {
    // Store monaco ref for later use (install → restart)
    monacoRef = monaco;

    const serverLang = resolveServerLanguage(languageId);

    // Already running or starting?
    const existing = get().servers[workspacePath]?.[serverLang];
    if (existing && (existing.status === "running" || existing.status === "starting")) {
      return existing.client;
    }

    // Don't retry if we know it's unavailable or installing
    if (existing?.status === "unavailable" || existing?.status === "installing") {
      return null;
    }

    // Prevent duplicate in-flight requests
    const pendingKey = `${workspacePath}:${serverLang}`;
    if (pending.has(pendingKey)) return null;
    pending.add(pendingKey);

    try {
      // Ask Rust to spawn the language server
      const result = await invoke<{ server_id: string; server_name: string }>("lsp_start", {
        workspacePath,
        languageId,
      });
      const serverId = result.server_id;
      const serverName = result.server_name;

      // Create transport and client
      const transport = new TauriLspTransport(serverId);
      await transport.connect();
      const client = new LspClient(transport);

      // Initialize the LSP server
      await client.initialize(workspacePath);

      // Register Monaco providers for all languages this server handles
      const monacoLangs = getMonacoLanguages(serverLang);
      const providerDisposables = registerLspProviders(monaco, client, monacoLangs);

      // Disable Monaco's built-in TS/JS diagnostics when LSP is handling it
      if (serverLang === "typescript") {
        monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
          noSemanticValidation: true,
          noSyntaxValidation: true,
        });
        monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
          noSemanticValidation: true,
          noSyntaxValidation: true,
        });
      }

      set((state) => ({
        servers: {
          ...state.servers,
          [workspacePath]: {
            ...state.servers[workspacePath],
            [serverLang]: {
              serverId,
              languageId: serverLang,
              client,
              status: "running" as const,
              serverName,
              errorMessage: null,
              providerDisposables,
            },
          },
        },
      }));

      return client;
    } catch (err) {
      const errorStr = String(err);

      // No server configured for this language — silently ignore
      if (errorStr.includes("No language server configured")) {
        return null;
      }

      // Detect "not found" errors (binary not on PATH)
      const isNotFound =
        errorStr.includes("not found") ||
        errorStr.includes("No such file") ||
        errorStr.includes("program not found") ||
        errorStr.includes("os error 2") ||
        errorStr.includes("The system cannot find");

      // Extract server name from backend error like "Failed to start <cmd>: ..."
      // or fall back to the language group name
      const nameMatch = errorStr.match(/Failed to start ([^:]+):/);
      const displayName = nameMatch?.[1] ?? serverLang;

      const status: ServerStatus = isNotFound ? "unavailable" : "error";
      const errorMessage = isNotFound
        ? `${displayName} is not installed`
        : `${displayName} failed to start`;

      console.error(`LSP ${status} for ${serverLang}:`, err);

      set((state) => ({
        servers: {
          ...state.servers,
          [workspacePath]: {
            ...state.servers[workspacePath],
            [serverLang]: {
              serverId: "",
              languageId: serverLang,
              client: null as unknown as LspClient,
              status,
              serverName: displayName,
              errorMessage,
              providerDisposables: [],
            },
          },
        },
      }));

      // Show toast notification for unavailable servers
      if (isNotFound) {
        const { installServer } = get();
        useToastStore.getState().addToast({
          message: `${displayName} is not installed`,
          type: "warning",
          action: {
            label: "Install",
            onClick: () => installServer(workspacePath, displayName),
          },
        });
      }

      return null;
    } finally {
      pending.delete(pendingKey);
    }
  },

  getClient: (workspacePath, languageId) => {
    const serverLang = resolveServerLanguage(languageId);
    const info = get().servers[workspacePath]?.[serverLang];
    return info?.status === "running" ? info.client : null;
  },

  installServer: async (workspacePath, serverName) => {
    // Find which language entry this server belongs to
    const workspace = get().servers[workspacePath];
    const langEntry = workspace
      ? Object.entries(workspace).find(([, info]) => info.serverName === serverName)
      : null;
    const serverLang = langEntry?.[0];

    // Update status to installing
    if (serverLang) {
      set((state) => ({
        servers: {
          ...state.servers,
          [workspacePath]: {
            ...state.servers[workspacePath],
            [serverLang]: {
              ...state.servers[workspacePath][serverLang],
              status: "installing" as const,
              errorMessage: null,
            },
          },
        },
      }));
    }

    try {
      await invoke("lsp_install_server", { name: serverName });

      useToastStore.getState().addToast({
        message: `${serverName} installed successfully`,
        type: "success",
      });

      // Clear the old entry so startServer can retry
      if (serverLang) {
        set((state) => ({
          servers: {
            ...state.servers,
            [workspacePath]: {
              ...state.servers[workspacePath],
              [serverLang]: {
                ...state.servers[workspacePath][serverLang],
                status: "stopped" as const,
                errorMessage: null,
              },
            },
          },
        }));
      }

      // Restart the server if we have a stored monaco reference
      if (monacoRef && serverLang) {
        await get().startServer(workspacePath, serverLang, monacoRef);
      }
    } catch (err) {
      const errorMessage = `Failed to install ${serverName}: ${err}`;
      console.error(errorMessage);

      useToastStore.getState().addToast({
        message: errorMessage,
        type: "error",
        duration: 12000,
      });

      if (serverLang) {
        set((state) => ({
          servers: {
            ...state.servers,
            [workspacePath]: {
              ...state.servers[workspacePath],
              [serverLang]: {
                ...state.servers[workspacePath][serverLang],
                status: "unavailable" as const,
                errorMessage,
              },
            },
          },
        }));
      }
    }
  },

  stopWorkspace: async (workspacePath) => {
    const workspace = get().servers[workspacePath];
    if (!workspace) return;

    for (const info of Object.values(workspace)) {
      // Dispose Monaco providers
      for (const d of info.providerDisposables) {
        d.dispose();
      }
      // Shutdown client
      if (info.client && info.status === "running") {
        try {
          await info.client.shutdown();
        } catch {
          info.client.dispose();
        }
      }
    }

    // Tell Rust to kill all servers for this workspace
    await invoke("lsp_stop_workspace", { workspacePath }).catch(() => {});

    set((state) => {
      const { [workspacePath]: _, ...restServers } = state.servers;
      const { [workspacePath]: __, ...restAvailability } = state.availability;
      return { servers: restServers, availability: restAvailability };
    });
  },
}));
