import type { Monaco } from "@monaco-editor/react";
import type {
  IDisposable,
  editor as monacoEditor,
  languages,
  IRange,
  Uri,
  IMarkdownString,
} from "monaco-editor";
import {
  type CompletionItem as LspCompletionItem,
  type CompletionList,
  type Location as LspLocation,
  type LocationLink,
  type PublishDiagnosticsParams,
  type Diagnostic,
  type MarkupContent,
  type TextEdit,
  type CodeAction,
  CompletionItemKind as LspCompletionItemKind,
  DiagnosticSeverity,
  InsertTextFormat,
} from "vscode-languageserver-protocol";
import type { LspClient } from "./client";

// ── Position/Range Conversions ──
// LSP: 0-based line, 0-based character
// Monaco: 1-based line, 1-based column

function toMonacoRange(range: {
  start: { line: number; character: number };
  end: { line: number; character: number };
}): IRange {
  return {
    startLineNumber: range.start.line + 1,
    startColumn: range.start.character + 1,
    endLineNumber: range.end.line + 1,
    endColumn: range.end.character + 1,
  };
}

function toLspPosition(position: { lineNumber: number; column: number }) {
  return {
    line: position.lineNumber - 1,
    character: position.column - 1,
  };
}

function toLspRange(range: IRange) {
  return {
    start: { line: range.startLineNumber - 1, character: range.startColumn - 1 },
    end: { line: range.endLineNumber - 1, character: range.endColumn - 1 },
  };
}

// ── CompletionItemKind Mapping ──

const completionKindMap: Record<number, number> = {
  [LspCompletionItemKind.Text]: 18,
  [LspCompletionItemKind.Method]: 0,
  [LspCompletionItemKind.Function]: 1,
  [LspCompletionItemKind.Constructor]: 2,
  [LspCompletionItemKind.Field]: 3,
  [LspCompletionItemKind.Variable]: 4,
  [LspCompletionItemKind.Class]: 5,
  [LspCompletionItemKind.Interface]: 7,
  [LspCompletionItemKind.Module]: 8,
  [LspCompletionItemKind.Property]: 9,
  [LspCompletionItemKind.Unit]: 12,
  [LspCompletionItemKind.Value]: 13,
  [LspCompletionItemKind.Enum]: 15,
  [LspCompletionItemKind.Keyword]: 17,
  [LspCompletionItemKind.Snippet]: 27,
  [LspCompletionItemKind.Color]: 19,
  [LspCompletionItemKind.File]: 20,
  [LspCompletionItemKind.Reference]: 21,
  [LspCompletionItemKind.Folder]: 23,
  [LspCompletionItemKind.EnumMember]: 16,
  [LspCompletionItemKind.Constant]: 14,
  [LspCompletionItemKind.Struct]: 6,
  [LspCompletionItemKind.Event]: 10,
  [LspCompletionItemKind.Operator]: 11,
  [LspCompletionItemKind.TypeParameter]: 24,
};

// ── Diagnostic Severity Mapping ──

function toMonacoSeverity(monaco: Monaco, severity?: DiagnosticSeverity): number {
  switch (severity) {
    case DiagnosticSeverity.Error:
      return monaco.MarkerSeverity.Error;
    case DiagnosticSeverity.Warning:
      return monaco.MarkerSeverity.Warning;
    case DiagnosticSeverity.Information:
      return monaco.MarkerSeverity.Info;
    case DiagnosticSeverity.Hint:
      return monaco.MarkerSeverity.Hint;
    default:
      return monaco.MarkerSeverity.Info;
  }
}

// ── MarkupContent → IMarkdownString ──

function toMarkdownString(
  content: string | MarkupContent | { language: string; value: string },
): IMarkdownString {
  if (typeof content === "string") {
    return { value: content };
  }
  if ("kind" in content) {
    return { value: content.value };
  }
  return { value: `\`\`\`${content.language}\n${content.value}\n\`\`\`` };
}

// ── Diagnostic deduplication ──

function markerFingerprint(m: {
  severity: number;
  message: string;
  startLineNumber: number;
  startColumn: number;
  endLineNumber: number;
  endColumn: number;
}): string {
  return `${m.severity}:${m.startLineNumber}:${m.startColumn}:${m.endLineNumber}:${m.endColumn}:${m.message}`;
}

// ── TextEdit → Monaco edit ──

function lspTextEditsToMonaco(edits: TextEdit[]): { range: IRange; text: string }[] {
  return edits.map((edit) => ({
    range: toMonacoRange(edit.range),
    text: edit.newText,
  }));
}

// ── WorkspaceEdit → Monaco workspace edits ──

function workspaceEditToMonaco(
  monaco: Monaco,
  client: LspClient,
  wsEdit: { changes?: Record<string, TextEdit[]>; documentChanges?: unknown[] },
): languages.IWorkspaceTextEdit[] {
  const edits: languages.IWorkspaceTextEdit[] = [];

  if (wsEdit.changes) {
    for (const [editUri, textEdits] of Object.entries(wsEdit.changes)) {
      for (const te of textEdits) {
        edits.push({
          resource: monaco.Uri.parse(client.fromServerUri(editUri)),
          textEdit: { range: toMonacoRange(te.range), text: te.newText },
          versionId: undefined,
        });
      }
    }
  }

  if (wsEdit.documentChanges) {
    for (const change of wsEdit.documentChanges) {
      const c = change as { textDocument?: { uri: string }; edits?: TextEdit[] };
      if (c.textDocument && c.edits) {
        for (const te of c.edits) {
          edits.push({
            resource: monaco.Uri.parse(client.fromServerUri(c.textDocument.uri)),
            textEdit: { range: toMonacoRange(te.range), text: te.newText },
            versionId: undefined,
          });
        }
      }
    }
  }

  return edits;
}

// ── Safe LSP call wrapper ──

async function safeLspCall<T>(
  label: string,
  languageId: string,
  fallback: T,
  fn: () => Promise<T>,
): Promise<T> {
  try {
    return await fn();
  } catch (e) {
    console.warn(`[LSP] ${label} failed for ${languageId}:`, e);
    return fallback;
  }
}

// ── Provider Registration ──

function registerIfCapable(
  capability: unknown,
  disposables: IDisposable[],
  register: () => IDisposable,
): void {
  if (!capability) return;
  disposables.push(register());
}

export function registerLspProviders(
  monaco: Monaco,
  client: LspClient,
  languageIds: string[],
): IDisposable[] {
  const disposables: IDisposable[] = [];

  for (const languageId of languageIds) {
    // Completion Provider (with resolve support)
    if (client.capabilities?.completionProvider) {
      const supportsResolve = client.capabilities.completionProvider.resolveProvider;

      disposables.push(
        monaco.languages.registerCompletionItemProvider(languageId, {
          triggerCharacters: client.capabilities.completionProvider.triggerCharacters ?? [
            ".",
            ":",
            "<",
            '"',
            "/",
            "@",
          ],
          provideCompletionItems: async (
            model: monacoEditor.ITextModel,
            position: { lineNumber: number; column: number },
          ) => {
            const uri = model.uri.toString();
            const lspPos = toLspPosition(position);
            return safeLspCall("Completion", languageId, { suggestions: [] }, async () => {
              const result = await client.completion(uri, lspPos.line, lspPos.character);
              if (!result) return { suggestions: [] };

              const items: LspCompletionItem[] = Array.isArray(result)
                ? result
                : (result as CompletionList).items;

              const suggestions = items.map((item) => {
                const insertText = item.insertText ?? item.label;
                const isSnippet = item.insertTextFormat === InsertTextFormat.Snippet;

                const suggestion: languages.CompletionItem & { _lspItem?: LspCompletionItem } = {
                  label: item.labelDetails
                    ? {
                        label: item.label,
                        description: item.labelDetails.description,
                        detail: item.labelDetails.detail,
                      }
                    : item.label,
                  kind: completionKindMap[item.kind ?? LspCompletionItemKind.Text] ?? 18,
                  insertText,
                  insertTextRules: isSnippet ? 4 : 0,
                  detail: item.detail,
                  documentation: item.documentation
                    ? toMarkdownString(item.documentation as string | MarkupContent)
                    : undefined,
                  sortText: item.sortText,
                  filterText: item.filterText,
                  preselect: item.preselect,
                  range:
                    item.textEdit && "range" in item.textEdit
                      ? toMonacoRange(item.textEdit.range)
                      : undefined,
                } as languages.CompletionItem & { _lspItem?: LspCompletionItem };

                if (supportsResolve) {
                  suggestion._lspItem = item;
                }

                return suggestion;
              });

              return {
                suggestions,
                incomplete: !Array.isArray(result) && (result as CompletionList).isIncomplete,
              };
            });
          },
          resolveCompletionItem: supportsResolve
            ? async (item: languages.CompletionItem) => {
                const lspItem = (
                  item as languages.CompletionItem & { _lspItem?: LspCompletionItem }
                )._lspItem;
                if (!lspItem) return item;

                try {
                  const resolved = await client.completionResolve(lspItem);

                  if (resolved.documentation) {
                    item.documentation = toMarkdownString(
                      resolved.documentation as string | MarkupContent,
                    );
                  }
                  if (resolved.detail) {
                    item.detail = resolved.detail;
                  }
                  if (resolved.additionalTextEdits) {
                    item.additionalTextEdits = lspTextEditsToMonaco(
                      resolved.additionalTextEdits,
                    ).map((e) => ({
                      range: e.range as IRange,
                      text: e.text,
                    }));
                  }
                } catch (e) {
                  console.warn(`[LSP] completionItem/resolve failed:`, e);
                }

                return item;
              }
            : undefined,
        }),
      );
    }

    // Hover Provider
    registerIfCapable(client.capabilities?.hoverProvider, disposables, () =>
      monaco.languages.registerHoverProvider(languageId, {
        provideHover: async (
          model: monacoEditor.ITextModel,
          position: { lineNumber: number; column: number },
        ) => {
          const uri = model.uri.toString();
          const lspPos = toLspPosition(position);
          return safeLspCall("Hover", languageId, null, async () => {
            const result = await client.hover(uri, lspPos.line, lspPos.character);
            if (!result) return null;
            const contents = Array.isArray(result.contents)
              ? result.contents.map((c) => toMarkdownString(c as string | MarkupContent))
              : [toMarkdownString(result.contents as string | MarkupContent)];

            return {
              contents,
              range: result.range ? toMonacoRange(result.range) : undefined,
            };
          });
        },
      }),
    );

    // Definition Provider
    registerIfCapable(client.capabilities?.definitionProvider, disposables, () =>
      monaco.languages.registerDefinitionProvider(languageId, {
        provideDefinition: async (
          model: monacoEditor.ITextModel,
          position: { lineNumber: number; column: number },
        ) => {
          const uri = model.uri.toString();
          const lspPos = toLspPosition(position);
          return safeLspCall("Definition", languageId, null, async () => {
            const result = await client.definition(uri, lspPos.line, lspPos.character);
            if (!result) return null;
            const locations = Array.isArray(result) ? result : [result];
            return locations.map((loc) => {
              if ("targetUri" in loc) {
                const link = loc as LocationLink;
                return {
                  uri: monaco.Uri.parse(client.fromServerUri(link.targetUri)),
                  range: toMonacoRange(link.targetRange),
                };
              }
              const location = loc as LspLocation;
              return {
                uri: monaco.Uri.parse(client.fromServerUri(location.uri)),
                range: toMonacoRange(location.range),
              };
            });
          });
        },
      }),
    );

    // References Provider
    registerIfCapable(client.capabilities?.referencesProvider, disposables, () =>
      monaco.languages.registerReferenceProvider(languageId, {
        provideReferences: async (
          model: monacoEditor.ITextModel,
          position: { lineNumber: number; column: number },
          _context: languages.ReferenceContext,
        ) => {
          const uri = model.uri.toString();
          const lspPos = toLspPosition(position);
          return safeLspCall("References", languageId, null, async () => {
            const result = await client.references(uri, lspPos.line, lspPos.character);
            if (!result) return null;
            return result.map((loc) => ({
              uri: monaco.Uri.parse(client.fromServerUri(loc.uri)) as Uri,
              range: toMonacoRange(loc.range),
            }));
          });
        },
      }),
    );

    // Signature Help Provider
    registerIfCapable(client.capabilities?.signatureHelpProvider, disposables, () =>
      monaco.languages.registerSignatureHelpProvider(languageId, {
        signatureHelpTriggerCharacters: client.capabilities!.signatureHelpProvider!
          .triggerCharacters ?? ["(", ","],
        provideSignatureHelp: async (
          model: monacoEditor.ITextModel,
          position: { lineNumber: number; column: number },
        ) => {
          const uri = model.uri.toString();
          const lspPos = toLspPosition(position);
          return safeLspCall("SignatureHelp", languageId, null, async () => {
            const result = await client.signatureHelp(uri, lspPos.line, lspPos.character);
            if (!result) return null;
            return {
              value: {
                signatures: result.signatures.map((sig) => ({
                  label: sig.label,
                  documentation: sig.documentation
                    ? toMarkdownString(sig.documentation as string | MarkupContent)
                    : undefined,
                  parameters: (sig.parameters ?? []).map((p) => ({
                    label: p.label as string,
                    documentation: p.documentation
                      ? toMarkdownString(p.documentation as string | MarkupContent)
                      : undefined,
                  })),
                })),
                activeSignature: result.activeSignature ?? 0,
                activeParameter: result.activeParameter ?? 0,
              },
              dispose: () => {},
            };
          });
        },
      }),
    );

    // Code Action Provider
    registerIfCapable(client.capabilities?.codeActionProvider, disposables, () =>
      monaco.languages.registerCodeActionProvider(languageId, {
        provideCodeActions: async (
          model: monacoEditor.ITextModel,
          range: monacoEditor.IIdentifiedSingleEditOperation["range"],
          context: languages.CodeActionContext,
        ) => {
          const uri = model.uri.toString();
          const lspRange = toLspRange(range as IRange);
          const diagnostics = context.markers.map((m) => ({
            range: toLspRange({
              startLineNumber: m.startLineNumber,
              startColumn: m.startColumn,
              endLineNumber: m.endLineNumber,
              endColumn: m.endColumn,
            }),
            message: m.message,
            severity: m.severity,
            code: m.code != null ? String(m.code) : undefined,
          }));

          const emptyResult = { actions: [] as languages.CodeAction[], dispose: () => {} };
          return safeLspCall("CodeAction", languageId, emptyResult, async () => {
            const result = await client.codeAction(uri, lspRange, diagnostics);
            if (!result) return emptyResult;

            const actions: languages.CodeAction[] = result
              .filter((item): item is CodeAction => "title" in item)
              .map((action) => {
                const monacoAction: languages.CodeAction = {
                  title: action.title,
                  kind: action.kind,
                  isPreferred: action.isPreferred,
                  diagnostics: action.diagnostics?.map((d) => ({
                    ...toMonacoRange(d.range),
                    message: d.message,
                    severity: toMonacoSeverity(monaco, d.severity),
                  })),
                };

                if (action.edit) {
                  const edits = workspaceEditToMonaco(monaco, client, action.edit);
                  if (edits.length > 0) {
                    monacoAction.edit = { edits };
                  }
                }

                return monacoAction;
              });

            return { actions, dispose: () => {} };
          });
        },
      }),
    );

    // Document Formatting Provider
    registerIfCapable(client.capabilities?.documentFormattingProvider, disposables, () =>
      monaco.languages.registerDocumentFormattingEditProvider(languageId, {
        provideDocumentFormattingEdits: async (
          model: monacoEditor.ITextModel,
          options: languages.FormattingOptions,
        ) => {
          const uri = model.uri.toString();
          return safeLspCall("Formatting", languageId, [], async () => {
            const edits = await client.formatting(uri, options.tabSize, options.insertSpaces);
            if (!edits) return [];
            return lspTextEditsToMonaco(edits);
          });
        },
      }),
    );

    // Range Formatting Provider
    registerIfCapable(client.capabilities?.documentRangeFormattingProvider, disposables, () =>
      monaco.languages.registerDocumentRangeFormattingEditProvider(languageId, {
        provideDocumentRangeFormattingEdits: async (
          model: monacoEditor.ITextModel,
          range: monacoEditor.IIdentifiedSingleEditOperation["range"],
          options: languages.FormattingOptions,
        ) => {
          const uri = model.uri.toString();
          return safeLspCall("Range formatting", languageId, [], async () => {
            const edits = await client.rangeFormatting(
              uri,
              toLspRange(range as IRange),
              options.tabSize,
              options.insertSpaces,
            );
            if (!edits) return [];
            return lspTextEditsToMonaco(edits);
          });
        },
      }),
    );

    // Rename Provider
    registerIfCapable(client.capabilities?.renameProvider, disposables, () => {
      const supportsPrepare =
        typeof client.capabilities!.renameProvider === "object" &&
        client.capabilities!.renameProvider!.prepareProvider;

      return monaco.languages.registerRenameProvider(languageId, {
        provideRenameEdits: async (
          model: monacoEditor.ITextModel,
          position: { lineNumber: number; column: number },
          newName: string,
        ) => {
          const uri = model.uri.toString();
          const lspPos = toLspPosition(position);
          return safeLspCall("Rename", languageId, { edits: [] }, async () => {
            const result = await client.rename(uri, lspPos.line, lspPos.character, newName);
            if (!result) return { edits: [] };
            return { edits: workspaceEditToMonaco(monaco, client, result) };
          });
        },
        resolveRenameLocation: supportsPrepare
          ? async (
              model: monacoEditor.ITextModel,
              position: { lineNumber: number; column: number },
            ) => {
              const uri = model.uri.toString();
              const lspPos = toLspPosition(position);
              const rejectResult = {
                range: { startLineNumber: 0, startColumn: 0, endLineNumber: 0, endColumn: 0 },
                text: "",
                rejectReason: "Rename preparation failed.",
              };
              return safeLspCall("PrepareRename", languageId, rejectResult, async () => {
                const result = await client.prepareRename(uri, lspPos.line, lspPos.character);
                if (!result) {
                  return { ...rejectResult, rejectReason: "This symbol cannot be renamed." };
                }
                if ("placeholder" in result) {
                  return { range: toMonacoRange(result.range), text: result.placeholder };
                }
                const range = toMonacoRange(result);
                const text = model.getValueInRange(range);
                return { range, text };
              });
            }
          : undefined,
      });
    });
  }

  // Diagnostics (via server notification, not a provider)
  client.onDiagnostics((params: PublishDiagnosticsParams) => {
    // O(1) model lookup via URI parsing instead of scanning all models
    const parsedUri = monaco.Uri.parse(params.uri);
    const model = monaco.editor.getModel(parsedUri);
    if (!model) return;

    const markers = params.diagnostics.map((d: Diagnostic) => ({
      severity: toMonacoSeverity(monaco, d.severity),
      message: d.message,
      source: d.source,
      ...toMonacoRange(d.range),
      code: d.code != null ? String(d.code) : undefined,
      tags: d.tags?.map((t) => (t === 1 ? 1 : 2)),
    }));

    // Skip update if markers haven't changed (avoids visual flicker with chatty servers)
    const existing = monaco.editor.getModelMarkers({ resource: model.uri, owner: "lsp" });
    if (existing.length === markers.length) {
      const newKey = markers.map(markerFingerprint).join("\n");
      const existingKey = existing.map(markerFingerprint).join("\n");
      if (newKey === existingKey) return;
    }

    monaco.editor.setModelMarkers(model, "lsp", markers as monacoEditor.IMarkerData[]);
  });

  return disposables;
}
