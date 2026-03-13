import {
  type InitializeParams,
  type InitializeResult,
  type ServerCapabilities,
  type TextDocumentContentChangeEvent,
  type CompletionItem,
  type CompletionList,
  type Hover,
  type Location,
  type LocationLink,
  type SignatureHelp,
  type PublishDiagnosticsParams,
  type DidOpenTextDocumentParams,
  type DidChangeTextDocumentParams,
  type DidCloseTextDocumentParams,
  type DidSaveTextDocumentParams,
  type CompletionParams,
  type HoverParams,
  type TextDocumentPositionParams,
  type ReferenceParams,
  type SignatureHelpParams,
  TextDocumentSyncKind,
} from "vscode-languageserver-protocol";
import { TauriLspTransport } from "./transport";
import { pathToFileUri } from "./uri";

export class LspClient {
  private transport: TauriLspTransport;
  capabilities: ServerCapabilities | null = null;
  private openDocuments = new Set<string>();

  constructor(transport: TauriLspTransport) {
    this.transport = transport;
  }

  async initialize(workspacePath: string): Promise<InitializeResult> {
    const rootUri = pathToFileUri(workspacePath);

    const params: InitializeParams = {
      processId: null,
      rootUri,
      capabilities: {
        textDocument: {
          synchronization: {
            dynamicRegistration: false,
            willSave: false,
            willSaveWaitUntil: false,
            didSave: true,
          },
          completion: {
            dynamicRegistration: false,
            completionItem: {
              snippetSupport: true,
              commitCharactersSupport: true,
              documentationFormat: ["markdown", "plaintext"],
              deprecatedSupport: true,
              preselectSupport: true,
              labelDetailsSupport: true,
              insertReplaceSupport: true,
              resolveSupport: {
                properties: ["documentation", "detail", "additionalTextEdits"],
              },
            },
            contextSupport: true,
          },
          hover: {
            dynamicRegistration: false,
            contentFormat: ["markdown", "plaintext"],
          },
          signatureHelp: {
            dynamicRegistration: false,
            signatureInformation: {
              documentationFormat: ["markdown", "plaintext"],
              parameterInformation: { labelOffsetSupport: true },
            },
          },
          definition: { dynamicRegistration: false },
          references: { dynamicRegistration: false },
          documentHighlight: { dynamicRegistration: false },
          documentSymbol: { dynamicRegistration: false },
          codeAction: {
            dynamicRegistration: false,
            codeActionLiteralSupport: {
              codeActionKind: {
                valueSet: [
                  "quickfix",
                  "refactor",
                  "refactor.extract",
                  "refactor.inline",
                  "refactor.rewrite",
                  "source",
                  "source.organizeImports",
                ],
              },
            },
          },
          formatting: { dynamicRegistration: false },
          rangeFormatting: { dynamicRegistration: false },
          rename: { dynamicRegistration: false, prepareSupport: true },
          publishDiagnostics: {
            relatedInformation: true,
            tagSupport: { valueSet: [1, 2] },
          },
        },
        workspace: {
          workspaceFolders: true,
        },
      },
      workspaceFolders: [{ uri: rootUri, name: workspacePath.split(/[\\/]/).pop() ?? "" }],
    };

    const result = await this.transport.sendRequest<InitializeResult>("initialize", params);
    this.capabilities = result.capabilities;

    // Send initialized notification
    this.transport.sendNotification("initialized", {});

    return result;
  }

  didOpen(uri: string, languageId: string, version: number, text: string): void {
    if (this.openDocuments.has(uri)) return;
    this.openDocuments.add(uri);

    const params: DidOpenTextDocumentParams = {
      textDocument: { uri, languageId, version, text },
    };
    this.transport.sendNotification("textDocument/didOpen", params);
  }

  didChange(uri: string, version: number, changes: TextDocumentContentChangeEvent[]): void {
    // Use full sync if server doesn't support incremental
    const syncKind =
      typeof this.capabilities?.textDocumentSync === "object"
        ? this.capabilities.textDocumentSync.change
        : this.capabilities?.textDocumentSync;

    let actualChanges = changes;
    if (syncKind === TextDocumentSyncKind.Full && changes.length > 0) {
      // For full sync, send just the last full-text change
      // (the caller should send full text when server requires it)
      actualChanges = changes;
    }

    const params: DidChangeTextDocumentParams = {
      textDocument: { uri, version },
      contentChanges: actualChanges,
    };
    this.transport.sendNotification("textDocument/didChange", params);
  }

  didClose(uri: string): void {
    if (!this.openDocuments.has(uri)) return;
    this.openDocuments.delete(uri);

    const params: DidCloseTextDocumentParams = {
      textDocument: { uri },
    };
    this.transport.sendNotification("textDocument/didClose", params);
  }

  didSave(uri: string, text?: string): void {
    const params: DidSaveTextDocumentParams = {
      textDocument: { uri },
      ...(text !== undefined && { text }),
    };
    this.transport.sendNotification("textDocument/didSave", params);
  }

  async completion(
    uri: string,
    line: number,
    character: number,
  ): Promise<CompletionList | CompletionItem[] | null> {
    const params: CompletionParams = {
      textDocument: { uri },
      position: { line, character },
    };
    return this.transport.sendRequest("textDocument/completion", params);
  }

  async hover(uri: string, line: number, character: number): Promise<Hover | null> {
    const params: HoverParams = {
      textDocument: { uri },
      position: { line, character },
    };
    return this.transport.sendRequest("textDocument/hover", params);
  }

  async definition(
    uri: string,
    line: number,
    character: number,
  ): Promise<Location | Location[] | LocationLink[] | null> {
    const params: TextDocumentPositionParams = {
      textDocument: { uri },
      position: { line, character },
    };
    return this.transport.sendRequest("textDocument/definition", params);
  }

  async references(uri: string, line: number, character: number): Promise<Location[] | null> {
    const params: ReferenceParams = {
      textDocument: { uri },
      position: { line, character },
      context: { includeDeclaration: true },
    };
    return this.transport.sendRequest("textDocument/references", params);
  }

  async signatureHelp(uri: string, line: number, character: number): Promise<SignatureHelp | null> {
    const params: SignatureHelpParams = {
      textDocument: { uri },
      position: { line, character },
    };
    return this.transport.sendRequest("textDocument/signatureHelp", params);
  }

  onDiagnostics(handler: (params: PublishDiagnosticsParams) => void): void {
    this.transport.onNotification(
      "textDocument/publishDiagnostics",
      handler as (params: unknown) => void,
    );
  }

  async shutdown(): Promise<void> {
    await this.transport.sendRequest("shutdown", null);
    this.transport.sendNotification("exit", null);
    this.transport.dispose();
  }

  dispose(): void {
    this.transport.dispose();
  }
}
