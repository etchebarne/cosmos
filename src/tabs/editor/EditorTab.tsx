import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import Editor, { type Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { TextDocumentSyncKind } from "vscode-languageserver-protocol";
import { useActiveWorkspace } from "../../contexts/WorkspaceContext";
import { useLspStore } from "../../lsp/lsp-store";
import { pathToFileUri } from "../../lsp/uri";
import { setupMonacoLanguages, resolveModelLanguage } from "../../lsp/monaco-languages";
import type { TabContentProps } from "../types";

let themeDefined = false;
function defineCosmosTheme(monaco: Monaco) {
  if (themeDefined) return;
  themeDefined = true;
  monaco.editor.defineTheme("cosmos", {
    base: "vs-dark",
    inherit: true,
    rules: [{ token: "tag", foreground: "569cd6" }],
    colors: {
      "editor.background": "#111116",
      "editor.foreground": "#e8e8ed",
      "editor.lineHighlightBackground": "#1a1a2280",
      "editor.selectionBackground": "#4b8ef540",
      "editor.inactiveSelectionBackground": "#4b8ef520",
      "editorLineNumber.foreground": "#4a4a58",
      "editorLineNumber.activeForeground": "#9d9daa",
      "editorCursor.foreground": "#4b8ef5",
      "editorIndentGuide.background": "#2e2e3a",
      "editorIndentGuide.activeBackground": "#3a3a48",
      "editorWidget.background": "#1a1a22",
      "editorWidget.border": "#2e2e3a",
      "editorSuggestWidget.background": "#1a1a22",
      "editorSuggestWidget.border": "#2e2e3a",
      "editorSuggestWidget.selectedBackground": "#222230",
      "scrollbarSlider.background": "rgba(255, 255, 255, 0.12)",
      "scrollbarSlider.hoverBackground": "rgba(255, 255, 255, 0.25)",
      "scrollbarSlider.activeBackground": "rgba(255, 255, 255, 0.35)",
    },
  });
}

export function EditorTab({ tab }: TabContentProps) {
  const filePath = tab.metadata?.filePath as string | undefined;
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [dirty, setDirty] = useState(false);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const contentRef = useRef<string | null>(null);
  const versionRef = useRef(0);
  const changeDisposableRef = useRef<{ dispose: () => void } | null>(null);

  const workspace = useActiveWorkspace();
  const startServer = useLspStore((s) => s.startServer);
  const getClient = useLspStore((s) => s.getClient);
  const lspLanguageRef = useRef<string>("plaintext");

  const fileUri = filePath ? pathToFileUri(filePath) : null;

  const loadFile = useCallback(async () => {
    if (!filePath) return;
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<string>("read_file", { path: filePath });
      setContent(result);
      contentRef.current = result;
      setDirty(false);
    } catch (e) {
      setError(String(e));
    } finally {
      setLoading(false);
    }
  }, [filePath]);

  useEffect(() => {
    loadFile();
  }, [loadFile]);

  const saveFile = useCallback(async () => {
    if (!filePath || contentRef.current === null) return;
    try {
      await invoke("write_file", { path: filePath, content: contentRef.current });
      setDirty(false);

      // Notify LSP of save
      if (workspace && fileUri) {
        const client = getClient(workspace.path, lspLanguageRef.current);
        client?.didSave(fileUri, contentRef.current);
      }
    } catch (e) {
      setError(String(e));
    }
  }, [filePath, workspace, fileUri, getClient]);

  // Cleanup on unmount: didClose + change listener
  useEffect(() => {
    return () => {
      changeDisposableRef.current?.dispose();
      if (workspace && fileUri) {
        const client = getClient(workspace.path, lspLanguageRef.current);
        client?.didClose(fileUri);
      }
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  function handleEditorDidMount(instance: editor.IStandaloneCodeEditor, monaco: Monaco) {
    editorRef.current = instance;
    monacoRef.current = monaco;

    // Remeasure fonts once loaded — fixes cursor offset when web fonts swap in
    document.fonts.ready.then(() => {
      if (editorRef.current) monaco.editor.remeasureFonts();
    });

    // Resolve the model to the most specific registered language (e.g.
    // "typescriptreact" instead of "typescript" for .tsx files).
    const model = instance.getModel();
    if (model) resolveModelLanguage(monaco, model);
    lspLanguageRef.current = model?.getLanguageId() ?? "plaintext";

    // Start LSP server and send didOpen
    if (workspace && fileUri && content !== null) {
      const lspLang = lspLanguageRef.current;
      startServer(workspace.path, lspLang, monaco).then((client) => {
        if (!client) return;
        versionRef.current = 1;
        client.didOpen(fileUri, lspLang, versionRef.current, instance.getValue());
      });
    }

    // eslint-disable-next-line no-bitwise
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveFile());

    // Listen for content changes to send didChange notifications
    changeDisposableRef.current = instance.onDidChangeModelContent((e) => {
      // Update local state
      contentRef.current = instance.getValue();
      if (!dirty) setDirty(true);

      // Send incremental changes to LSP
      if (!workspace || !fileUri) return;
      const client = getClient(workspace.path, lspLanguageRef.current);
      if (!client) return;

      versionRef.current++;

      // Check if server wants full or incremental sync
      const syncKind =
        typeof client.capabilities?.textDocumentSync === "object"
          ? client.capabilities.textDocumentSync.change
          : client.capabilities?.textDocumentSync;

      if (syncKind === TextDocumentSyncKind.Full) {
        client.didChange(fileUri, versionRef.current, [{ text: instance.getValue() }]);
      } else {
        // Incremental: send only the changes
        const changes = e.changes.map((change) => ({
          range: {
            start: {
              line: change.range.startLineNumber - 1,
              character: change.range.startColumn - 1,
            },
            end: {
              line: change.range.endLineNumber - 1,
              character: change.range.endColumn - 1,
            },
          },
          rangeLength: change.rangeLength,
          text: change.text,
        }));
        client.didChange(fileUri, versionRef.current, changes);
      }
    });
  }

  function handleBeforeMount(monaco: Monaco) {
    monacoRef.current = monaco;
    defineCosmosTheme(monaco);
    setupMonacoLanguages(monaco);

    // Disable Monaco's built-in TS/JS diagnostics unconditionally.
    // They run in-browser without tsconfig/node_modules so they always
    // produce false positives. Real diagnostics come from the LSP server.
    monaco.languages.typescript.typescriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
    });
    monaco.languages.typescript.javascriptDefaults.setDiagnosticsOptions({
      noSemanticValidation: true,
      noSyntaxValidation: true,
    });
  }

  if (!filePath) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-[var(--color-text-muted)]">No file path</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-[var(--color-text-secondary)]">Loading...</p>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-[var(--color-status-red)]">{error}</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full">
      {dirty && (
        <div className="flex items-center h-6 px-3 bg-[var(--color-bg-surface)] border-b border-[var(--color-border-primary)]">
          <span className="text-[11px] text-[var(--color-text-secondary)]">
            Modified — Ctrl+S to save
          </span>
        </div>
      )}
      <div className="flex-1 min-h-0">
        <Editor
          path={fileUri ?? undefined}
          defaultValue={content ?? ""}
          theme="cosmos"
          beforeMount={handleBeforeMount}
          onMount={handleEditorDidMount}
          options={{
            fontFamily: "'JetBrains Mono', monospace",
            fontSize: 13,
            lineHeight: 1.6,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            padding: { top: 12 },
            renderLineHighlight: "line",
            smoothScrolling: true,
            cursorBlinking: "smooth",
            cursorSmoothCaretAnimation: "on",
            bracketPairColorization: { enabled: true },
            guides: {
              indentation: true,
              bracketPairs: true,
            },
            overviewRulerBorder: false,
            hideCursorInOverviewRuler: true,
            scrollbar: {
              verticalScrollbarSize: 6,
              horizontalScrollbarSize: 6,
              useShadows: false,
            },
            wordWrap: "on",
            roundedSelection: false,
            contextmenu: false,
            automaticLayout: true,
          }}
        />
      </div>
    </div>
  );
}
