import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

interface JsonRpcRequest {
  jsonrpc: "2.0";
  id: number;
  method: string;
  params?: unknown;
}

interface JsonRpcNotification {
  jsonrpc: "2.0";
  method: string;
  params?: unknown;
}

interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: number;
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

type JsonRpcMessage = JsonRpcRequest | JsonRpcNotification | JsonRpcResponse;

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

/**
 * Tauri-based JSON-RPC transport for LSP.
 * Sends messages via invoke("lsp_send") and receives via Tauri events.
 */
export class TauriLspTransport {
  private serverId: string;
  private requestId = 0;
  private pendingRequests = new Map<number, PendingRequest>();
  private notificationHandlers = new Map<string, ((params: unknown) => void)[]>();
  private unlistenMessage: UnlistenFn | null = null;
  private unlistenStatus: UnlistenFn | null = null;
  private disposed = false;

  constructor(serverId: string) {
    this.serverId = serverId;
  }

  async connect(): Promise<void> {
    this.unlistenMessage = await listen<string>(`lsp-message:${this.serverId}`, (event) => {
      this.handleMessage(event.payload);
    });

    this.unlistenStatus = await listen<string>(`lsp-status:${this.serverId}`, (event) => {
      if (event.payload === "stopped") {
        this.handleServerStopped();
      }
    });
  }

  async sendRequest<R>(method: string, params?: unknown): Promise<R> {
    if (this.disposed) throw new Error("Transport disposed");

    const id = ++this.requestId;
    const request: JsonRpcRequest = { jsonrpc: "2.0", id, method, params };

    return new Promise<R>((resolve, reject) => {
      this.pendingRequests.set(id, {
        resolve: resolve as (value: unknown) => void,
        reject,
      });

      invoke("lsp_send", {
        serverId: this.serverId,
        message: JSON.stringify(request),
      }).catch((err) => {
        this.pendingRequests.delete(id);
        reject(err);
      });
    });
  }

  sendNotification(method: string, params?: unknown): void {
    if (this.disposed) return;

    const notification: JsonRpcNotification = { jsonrpc: "2.0", method, params };
    invoke("lsp_send", {
      serverId: this.serverId,
      message: JSON.stringify(notification),
    }).catch(() => {
      // Notification delivery is best-effort
    });
  }

  onNotification(method: string, handler: (params: unknown) => void): void {
    const handlers = this.notificationHandlers.get(method) ?? [];
    handlers.push(handler);
    this.notificationHandlers.set(method, handlers);
  }

  dispose(): void {
    this.disposed = true;
    this.unlistenMessage?.();
    this.unlistenStatus?.();

    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error("Transport disposed"));
    }
    this.pendingRequests.clear();
    this.notificationHandlers.clear();
  }

  private handleMessage(raw: string): void {
    let msg: JsonRpcMessage;
    try {
      msg = JSON.parse(raw);
    } catch {
      return;
    }

    // Response to a request we sent
    if ("id" in msg && msg.id != null && !("method" in msg)) {
      const response = msg as JsonRpcResponse;
      const pending = this.pendingRequests.get(response.id);
      if (pending) {
        this.pendingRequests.delete(response.id);
        if (response.error) {
          pending.reject(new Error(`LSP error ${response.error.code}: ${response.error.message}`));
        } else {
          pending.resolve(response.result);
        }
      }
      return;
    }

    // Server-initiated notification (no id) or server request (has id + method)
    if ("method" in msg) {
      const notification = msg as JsonRpcNotification;
      const handlers = this.notificationHandlers.get(notification.method);
      if (handlers) {
        for (const handler of handlers) {
          handler(notification.params);
        }
      }
    }
  }

  private handleServerStopped(): void {
    for (const [, pending] of this.pendingRequests) {
      pending.reject(new Error("Language server stopped"));
    }
    this.pendingRequests.clear();
  }
}
