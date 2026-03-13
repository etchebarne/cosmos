import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import type { Monaco } from "@monaco-editor/react";
import type { IDisposable } from "monaco-editor";
import { TauriLspTransport } from "./transport";
import { LspClient } from "./client";
import { registerLspProviders } from "./monaco-bridge";

export type ServerStatus = "starting" | "running" | "stopped" | "error" | "unavailable";

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
}

// Map Monaco language IDs to the server-level language ID
function resolveServerLanguage(languageId: string): string {
  switch (languageId) {
    case "javascript":
    case "typescript":
    case "typescriptreact":
    case "javascriptreact":
      return "typescript";
    default:
      return languageId;
  }
}

// Get all Monaco language IDs that a server handles
function getMonacoLanguages(serverLanguage: string): string[] {
  switch (serverLanguage) {
    case "typescript":
      return ["typescript", "javascript", "typescriptreact", "javascriptreact"];
    default:
      return [serverLanguage];
  }
}

// Map language IDs to human-readable server names
function getServerDisplayName(languageId: string): string {
  switch (languageId) {
    case "typescript":
      return "typescript-language-server";
    case "rust":
      return "rust-analyzer";
    case "python":
      return "pylsp";
    case "go":
      return "gopls";
    default:
      return `${languageId}-server`;
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
    const serverLang = resolveServerLanguage(languageId);

    // Already running or starting?
    const existing = get().servers[workspacePath]?.[serverLang];
    if (existing && (existing.status === "running" || existing.status === "starting")) {
      return existing.client;
    }

    // Don't retry if we know it's unavailable
    if (existing?.status === "unavailable") {
      return null;
    }

    const serverName = getServerDisplayName(serverLang);

    // Mark as starting
    set((state) => ({
      servers: {
        ...state.servers,
        [workspacePath]: {
          ...state.servers[workspacePath],
          [serverLang]: {
            serverId: "",
            languageId: serverLang,
            client: null as unknown as LspClient,
            status: "starting" as const,
            serverName,
            errorMessage: null,
            providerDisposables: [],
          },
        },
      },
    }));

    try {
      // Ask Rust to spawn the language server
      const serverId = await invoke<string>("lsp_start", {
        workspacePath,
        languageId,
      });

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
      // Detect "not found" errors (binary not on PATH)
      const isNotFound =
        errorStr.includes("not found") ||
        errorStr.includes("No such file") ||
        errorStr.includes("program not found") ||
        errorStr.includes("os error 2") ||
        errorStr.includes("The system cannot find");

      const status: ServerStatus = isNotFound ? "unavailable" : "error";
      const errorMessage = isNotFound
        ? `${serverName} is not installed`
        : `${serverName} failed to start`;

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
              serverName,
              errorMessage,
              providerDisposables: [],
            },
          },
        },
      }));
      return null;
    }
  },

  getClient: (workspacePath, languageId) => {
    const serverLang = resolveServerLanguage(languageId);
    const info = get().servers[workspacePath]?.[serverLang];
    return info?.status === "running" ? info.client : null;
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
