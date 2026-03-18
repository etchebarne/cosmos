import { create } from "zustand";
import { immer } from "zustand/middleware/immer";
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
  languageId: string;
  serverName: string;
  available: boolean;
}

export interface LspServerInfo {
  serverId: string;
  languageId: string;
  client: LspClient | null;
  status: ServerStatus;
  serverName: string;
  errorMessage: string | null;
  providerDisposables: IDisposable[];
}

export interface IndexProgress {
  serverName: string;
  title: string;
  message?: string;
  percentage?: number;
}

interface LspState {
  // workspace path -> language -> server info
  servers: Record<string, Record<string, LspServerInfo>>;
  // workspace path -> availability info
  availability: Record<string, ServerAvailability[]>;
  // workspace path -> active indexing progress items
  indexProgress: Record<string, IndexProgress[]>;

  warmupWorkspace: (workspacePath: string) => Promise<void>;
  startServer: (
    workspacePath: string,
    languageId: string,
    filePath: string | null,
    monaco: Monaco,
  ) => Promise<LspClient | null>;
  getClient: (workspacePath: string, languageId: string) => LspClient | null;
  stopWorkspace: (workspacePath: string) => Promise<void>;
  checkAvailability: (workspacePath: string) => Promise<void>;
  installServer: (workspacePath: string, serverName: string) => Promise<void>;
}

// Store monaco instance for restarting servers after install
let monacoRef: Monaco | null = null;

// Track in-flight server starts so concurrent callers share the same promise
const pending = new Map<string, Promise<LspClient | null>>();

// ── Language group resolution (single source of truth: backend) ──

let languageGroupMap: Record<string, string> | null = null;

async function ensureLanguageGroups(): Promise<void> {
  if (languageGroupMap) return;
  try {
    languageGroupMap = await invoke<Record<string, string>>("lsp_language_groups");
  } catch {
    languageGroupMap = {};
  }
}

export function resolveServerLanguage(languageId: string): string {
  return languageGroupMap?.[languageId] ?? languageId;
}

function getMonacoLanguages(serverLanguage: string): string[] {
  const languages = [serverLanguage];
  if (languageGroupMap) {
    for (const [lang, group] of Object.entries(languageGroupMap)) {
      if (group === serverLanguage && !languages.includes(lang)) {
        languages.push(lang);
      }
    }
  }
  return languages;
}

const SHUTDOWN_TIMEOUT_MS = 5_000;

/** Maximum restart attempts before giving up. */
const MAX_RESTART_ATTEMPTS = 2;
/** Delay between restart attempts in milliseconds. */
const RESTART_DELAY_MS = 5_000;

// Track active progress tokens across all servers.
// Key: "workspacePath\0serverLang\0token"
const progressTokens = new Map<string, IndexProgress>();

function progressKey(workspacePath: string, serverLang: string, token: string | number): string {
  return `${workspacePath}\0${serverLang}\0${token}`;
}

// Track restart attempts per server to implement backoff
const restartAttempts = new Map<string, number>();

export const useLspStore = create<LspState>()(
  immer((set, get) => {
    // ── Shared helpers (use set/get from closure) ──

    /** Recompute the indexProgress store slice for a workspace from the token map. */
    function syncProgressState(workspacePath: string) {
      const prefix = workspacePath + "\0";
      const entries: IndexProgress[] = [];
      for (const [key, progress] of progressTokens) {
        if (key.startsWith(prefix)) {
          entries.push(progress);
        }
      }
      set((state) => {
        state.indexProgress[workspacePath] = entries;
      });
    }

    /** Update the store status when a server unexpectedly stops. */
    function handleServerStopped(workspacePath: string, serverLang: string, error?: string | null) {
      const info = get().servers[workspacePath]?.[serverLang];
      if (info && info.status === "running") {
        set((state) => {
          const server = state.servers[workspacePath]?.[serverLang];
          if (server) {
            server.status = "stopped";
            server.errorMessage = error ?? null;
          }
        });

        // Attempt automatic restart with backoff
        const key = `${workspacePath}:${serverLang}`;
        const attempts = restartAttempts.get(key) ?? 0;

        if (attempts < MAX_RESTART_ATTEMPTS && monacoRef) {
          restartAttempts.set(key, attempts + 1);
          const monaco = monacoRef;

          console.warn(
            `[LSP] Server ${serverLang} stopped unexpectedly. ` +
              `Restart attempt ${attempts + 1}/${MAX_RESTART_ATTEMPTS} in ${RESTART_DELAY_MS}ms...`,
          );

          setTimeout(() => {
            // Clear old server entry so startServer doesn't see it as "stopped"
            set((state) => {
              const ws = state.servers[workspacePath];
              if (ws) delete ws[serverLang];
            });

            get()
              .startServer(workspacePath, serverLang, null, monaco)
              .then((client) => {
                if (client) {
                  // Reset attempts on successful restart
                  restartAttempts.delete(key);
                  console.info(`[LSP] Server ${serverLang} restarted successfully.`);
                }
              })
              .catch((err) => {
                console.error(`[LSP] Restart failed for ${serverLang}:`, err);
              });
          }, RESTART_DELAY_MS);
        } else if (attempts >= MAX_RESTART_ATTEMPTS) {
          console.error(
            `[LSP] Server ${serverLang} stopped. Max restart attempts (${MAX_RESTART_ATTEMPTS}) reached.`,
          );
          restartAttempts.delete(key);
        }
      }
    }

    /** Register Monaco providers for a running server that doesn't have them yet. */
    function ensureProviders(
      workspacePath: string,
      serverLang: string,
      info: LspServerInfo,
      monaco: Monaco,
    ) {
      if (info.providerDisposables.length > 0 || !info.client) return;

      const monacoLangs = getMonacoLanguages(serverLang);
      const providerDisposables = registerLspProviders(monaco, info.client, monacoLangs);

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

      set((state) => {
        const server = state.servers[workspacePath]?.[serverLang];
        if (server) {
          server.providerDisposables = providerDisposables;
        }
      });
    }

    /**
     * Core server initialization: spawn, connect transport, LSP initialize.
     * `projectRoot` is the resolved project root used for cwd and rootUri.
     * `workspacePath` is the user's workspace used as the store key.
     * Does NOT register Monaco providers — that's handled separately.
     * Returns the client on success, throws on failure.
     */
    async function initializeServer(
      workspacePath: string,
      projectRoot: string,
      languageId: string,
    ): Promise<LspClient | null> {
      await ensureLanguageGroups();
      const serverLang = resolveServerLanguage(languageId);

      // Already running?
      const existing = get().servers[workspacePath]?.[serverLang];
      if (existing && (existing.status === "running" || existing.status === "starting")) {
        return existing.status === "running" ? existing.client : null;
      }
      if (existing?.status === "unavailable" || existing?.status === "installing") {
        return null;
      }

      // Deduplicate concurrent calls
      const pendingKey = `${workspacePath}:${serverLang}`;
      const inflight = pending.get(pendingKey);
      if (inflight) return inflight;

      const promise = (async (): Promise<LspClient | null> => {
        // Ask Rust to spawn the language server with the resolved project root
        const result = await invoke<{
          serverId: string;
          serverName: string;
          serverLanguage: string;
        }>("lsp_start", {
          workspacePath: projectRoot,
          languageId,
        });

        // Create transport and client
        const transport = new TauriLspTransport(result.serverId);
        await transport.connect();
        // For remote workspaces (wsl://distro/path), pass the prefix so the
        // client can map URIs between editor paths and native Linux paths.
        const wslMatch = projectRoot.match(/^(wsl:\/\/[^/]+)/);
        const client = new LspClient(transport, wslMatch?.[1]);

        transport.onServerStopped((error) => handleServerStopped(workspacePath, serverLang, error));

        await client.initialize(projectRoot);

        // Track work-done progress (indexing, loading, etc.)
        client.onProgress((token, value) => {
          const key = progressKey(workspacePath, serverLang, token);
          if (value.kind === "begin") {
            progressTokens.set(key, {
              serverName: result.serverName,
              title: value.title,
              message: value.message,
              percentage: value.percentage,
            });
          } else if (value.kind === "report") {
            const existing = progressTokens.get(key);
            if (existing) {
              progressTokens.set(key, {
                ...existing,
                message: value.message ?? existing.message,
                percentage: value.percentage ?? existing.percentage,
              });
            }
          } else if (value.kind === "end") {
            progressTokens.delete(key);
          }
          syncProgressState(workspacePath);
        });

        // Store under the user's workspace path (for organization/cleanup)
        set((state) => {
          if (!state.servers[workspacePath]) {
            state.servers[workspacePath] = {};
          }
          state.servers[workspacePath][serverLang] = {
            serverId: result.serverId,
            languageId: serverLang,
            client,
            status: "running",
            serverName: result.serverName,
            errorMessage: null,
            providerDisposables: [],
          };
        });

        return client;
      })();

      pending.set(pendingKey, promise);
      promise.finally(() => pending.delete(pendingKey));
      return promise;
    }

    return {
      servers: {},
      availability: {},
      indexProgress: {},

      checkAvailability: async (workspacePath) => {
        try {
          const result = await invoke<ServerAvailability[]>("lsp_check_availability", {
            workspacePath,
          });
          set((state) => {
            state.availability[workspacePath] = result;
          });
        } catch (err) {
          console.error("Failed to check LSP availability:", err);
        }
      },

      warmupWorkspace: async (workspacePath) => {
        await ensureLanguageGroups();

        // Deep-scan the workspace tree for project markers (Cargo.toml, package.json, etc.)
        // at any depth, with each project resolved to its correct root directory.
        let projects: { languageId: string; projectRoot: string; available: boolean }[];
        try {
          projects = await invoke<typeof projects>("lsp_scan_projects", { workspacePath });
        } catch {
          return;
        }

        // Start each available server concurrently in the background.
        // Each server gets the resolved project root as its cwd and rootUri.
        for (const project of projects) {
          if (!project.available) continue;

          const serverLang = resolveServerLanguage(project.languageId);
          const existing = get().servers[workspacePath]?.[serverLang];
          if (existing) continue;

          initializeServer(workspacePath, project.projectRoot, project.languageId).catch((err) => {
            console.warn(`[LSP] Warmup failed for ${project.languageId}:`, err);
          });
        }
      },

      startServer: async (workspacePath, languageId, filePath, monaco) => {
        monacoRef = monaco;
        await ensureLanguageGroups();
        const serverLang = resolveServerLanguage(languageId);

        // If server is already running (e.g. from warmup), ensure providers are registered
        const existing = get().servers[workspacePath]?.[serverLang];
        if (existing && existing.status === "running") {
          ensureProviders(workspacePath, serverLang, existing, monaco);
          return existing.client;
        }

        // Don't retry if we know it's unavailable or installing
        if (existing?.status === "unavailable" || existing?.status === "installing") {
          return null;
        }

        // Resolve the actual project root: walk up from the file to find the
        // nearest project marker (Cargo.toml, package.json, etc.)
        let projectRoot = workspacePath;
        if (filePath) {
          try {
            projectRoot = await invoke<string>("lsp_resolve_root", {
              filePath,
              languageId,
              workspacePath,
            });
          } catch {
            // Fall back to workspace root
          }
        }

        try {
          // May share an in-flight promise from warmupWorkspace or another startServer call
          const pendingKey = `${workspacePath}:${serverLang}`;
          const inflight = pending.get(pendingKey);

          const client = inflight
            ? await inflight
            : await initializeServer(workspacePath, projectRoot, languageId);
          if (client) {
            const info = get().servers[workspacePath]?.[serverLang];
            if (info) ensureProviders(workspacePath, serverLang, info, monaco);
          }
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

          const nameMatch = errorStr.match(/Failed to start ([^:]+):/);
          const displayName = nameMatch?.[1] ?? serverLang;

          const status: ServerStatus = isNotFound ? "unavailable" : "error";
          const errorMessage = isNotFound
            ? `${displayName} is not installed`
            : `${displayName} failed to start`;

          console.error(`LSP ${status} for ${serverLang}:`, err);

          // Guard: another concurrent startServer may have already handled this
          const already = get().servers[workspacePath]?.[serverLang];
          if (already?.status === "unavailable" || already?.status === "error") {
            return null;
          }

          set((state) => {
            if (!state.servers[workspacePath]) {
              state.servers[workspacePath] = {};
            }
            state.servers[workspacePath][serverLang] = {
              serverId: "",
              languageId: serverLang,
              client: null,
              status,
              serverName: displayName,
              errorMessage,
              providerDisposables: [],
            };
          });

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
        }
      },

      getClient: (workspacePath, languageId) => {
        const serverLang = resolveServerLanguage(languageId);
        const info = get().servers[workspacePath]?.[serverLang];
        return info?.status === "running" ? info.client : null;
      },

      installServer: async (workspacePath, serverName) => {
        const workspace = get().servers[workspacePath];
        const langEntry = workspace
          ? Object.entries(workspace).find(([, info]) => info.serverName === serverName)
          : null;
        const serverLang = langEntry?.[0];

        if (serverLang) {
          set((state) => {
            const server = state.servers[workspacePath]?.[serverLang];
            if (server) {
              server.status = "installing";
              server.errorMessage = null;
            }
          });
        }

        try {
          await invoke("lsp_install_server", { name: serverName, workspacePath });

          useToastStore.getState().addToast({
            message: `${serverName} installed successfully`,
            type: "success",
          });

          if (serverLang) {
            set((state) => {
              const server = state.servers[workspacePath]?.[serverLang];
              if (server) {
                server.status = "stopped";
                server.errorMessage = null;
              }
            });
          }

          if (monacoRef && serverLang) {
            await get().startServer(workspacePath, serverLang, null, monacoRef);
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
            set((state) => {
              const server = state.servers[workspacePath]?.[serverLang];
              if (server) {
                server.status = "unavailable";
                server.errorMessage = errorMessage;
              }
            });
          }
        }
      },

      stopWorkspace: async (workspacePath) => {
        const workspace = get().servers[workspacePath];
        if (!workspace) return;

        // Shutdown all servers in parallel
        const shutdownPromises = Object.values(workspace).map(async (info) => {
          for (const d of info.providerDisposables) {
            d.dispose();
          }
          if (info.client && info.status === "running") {
            try {
              await Promise.race([
                info.client.shutdown(),
                new Promise<void>((_, reject) =>
                  setTimeout(() => reject(new Error("Shutdown timed out")), SHUTDOWN_TIMEOUT_MS),
                ),
              ]);
            } catch {
              info.client.dispose();
            }
          }
          // Stop the specific server on the backend by ID (handles resolved roots correctly)
          if (info.serverId) {
            await invoke("lsp_stop", { serverId: info.serverId }).catch(() => {});
          }
        });

        await Promise.allSettled(shutdownPromises);

        // Clean up progress tokens for this workspace
        const prefix = workspacePath + "\0";
        for (const key of progressTokens.keys()) {
          if (key.startsWith(prefix)) progressTokens.delete(key);
        }

        // Clean up restart attempt tracking
        for (const key of restartAttempts.keys()) {
          if (key.startsWith(workspacePath + ":")) restartAttempts.delete(key);
        }

        set((state) => {
          delete state.servers[workspacePath];
          delete state.availability[workspacePath];
          delete state.indexProgress[workspacePath];
        });
      },
    };
  }),
);
