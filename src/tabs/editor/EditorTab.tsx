import { useState, useEffect, useCallback, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import Editor, { type Monaco } from "@monaco-editor/react";
import type { editor, Uri, IRange, IPosition } from "monaco-editor";
import {
  TextDocumentSyncKind,
  type TextDocumentContentChangeEvent,
} from "vscode-languageserver-protocol";
import { useActiveWorkspace } from "../../contexts/WorkspaceContext";
import { useLspStore } from "../../store/lsp.store";
import { pathToFileUri, fileUriToPath } from "../../lib/lsp/uri";
import { useLayoutStore } from "../../store/layout.store";
import { useEditorStore } from "../../store/editor.store";
import { setupMonacoLanguages, resolveModelLanguage } from "../../lib/lsp/monaco-languages";
import { getTheme } from "../../lib/themes";
import { useThemeListener } from "../../hooks/use-theme-listener";
import { getEditorMeta } from "../../types";
import { StateView } from "../../components/shared/StateView";
import { BASE_EDITOR_OPTIONS } from "../../lib/monaco-config";
import { initExtMap, languageIdFromExt } from "../../lib/ext-to-lang";
import { getFileName, normalizePath, getFileExtension } from "../../lib/path-utils";
import type { TabContentProps } from "../types";

// ── Language detection from file extension (for early LSP start) ──

function languageIdFromPath(filePath: string): string {
  const ext = getFileExtension(filePath);
  return (ext && languageIdFromExt(ext)) ?? "plaintext";
}

// ── Cross-file navigation (Ctrl+Click go-to-definition) ──

interface EditorCacheEntry {
  instance: editor.IStandaloneCodeEditor;
  pendingReveal?: { lineNumber: number; column: number };
}

const editorCache = new Map<string, EditorCacheEntry>();
let editorOpenerRegistered = false;

/** Clear module-level caches for a workspace path prefix. */
export function cleanupEditorInstances(workspacePath: string) {
  for (const key of editorCache.keys()) {
    if (key.startsWith(workspacePath)) editorCache.delete(key);
  }
}

/** Reveal a position in an already-open editor, or queue it for when the editor mounts. */
export function revealPosition(filePath: string, position: { lineNumber: number; column: number }) {
  const entry = editorCache.get(filePath);
  if (entry) {
    entry.pendingReveal = position;
  } else {
    editorCache.set(filePath, { instance: null!, pendingReveal: position });
  }

  // For already-mounted editors (handleEditorDidMount won't fire again),
  // schedule a deferred reveal after layout settles.
  setTimeout(() => {
    const cached = editorCache.get(filePath);
    if (!cached || cached.pendingReveal !== position) return; // consumed or replaced
    if (cached.instance) {
      cached.pendingReveal = undefined;
      cached.instance.setPosition(position);
      cached.instance.revealPositionInCenter(position);
    }
  }, 50);
}

/** Convert a file URI to an OS path with the drive letter uppercased to match OS convention. */
function uriToNormalizedPath(uri: string): string {
  let p = fileUriToPath(uri);
  // Uppercase drive letter to match Windows OS convention (OS returns C:\, but URIs use c:/)
  if (/^[a-z]:/.test(p)) {
    p = p[0].toUpperCase() + p.slice(1);
  }
  return p;
}

function registerEditorOpener(monaco: Monaco) {
  if (editorOpenerRegistered) return;
  editorOpenerRegistered = true;

  monaco.editor.registerEditorOpener({
    openCodeEditor(
      source: editor.ICodeEditor,
      resource: Uri,
      selectionOrPosition?: IRange | IPosition,
    ) {
      // If the definition is in the same file, let Monaco's default handler
      // navigate within the current editor.
      const sourceModel = source.getModel();
      if (sourceModel && sourceModel.uri.toString() === resource.toString()) {
        return false;
      }

      const filePath = uriToNormalizedPath(resource.toString());
      const fileName = getFileName(filePath);

      // Determine target position
      let position: { lineNumber: number; column: number } | undefined;
      if (selectionOrPosition) {
        if ("lineNumber" in selectionOrPosition) {
          position = {
            lineNumber: selectionOrPosition.lineNumber,
            column: selectionOrPosition.column,
          };
        } else {
          position = {
            lineNumber: selectionOrPosition.startLineNumber,
            column: selectionOrPosition.startColumn,
          };
        }
      }

      const store = useLayoutStore.getState();
      store.openFile(filePath, fileName, store.activePaneId ?? "");

      if (position) {
        revealPosition(filePath, position);
      }

      return true;
    },
  });
}

export function defineKosmosTheme(monaco: Monaco) {
  const t = getTheme();
  monaco.editor.defineTheme("kosmos", {
    base: t.type === "dark" ? "vs-dark" : "vs",
    inherit: true,
    rules: [{ token: "tag", foreground: "569cd6" }],
    colors: {
      "editor.background": t.editor.background,
      "editor.foreground": t.editor.foreground,
      "editor.lineHighlightBackground": t.editor.lineHighlight,
      "editor.selectionBackground": t.editor.selection,
      "editor.inactiveSelectionBackground": t.editor.inactiveSelection,
      "editorLineNumber.foreground": t.editor.lineNumber,
      "editorLineNumber.activeForeground": t.editor.lineNumberActive,
      "editorCursor.foreground": t.editor.cursor,
      "editorIndentGuide.background": t.editor.indentGuide,
      "editorIndentGuide.activeBackground": t.editor.indentGuideActive,
      "editorWidget.background": t.editor.widget,
      "editorWidget.border": t.editor.widgetBorder,
      "editorSuggestWidget.background": t.editor.suggestBackground,
      "editorSuggestWidget.border": t.editor.suggestBorder,
      "editorSuggestWidget.selectedBackground": t.editor.suggestSelected,
      "scrollbarSlider.background": t.ui.scrollbar.track,
      "scrollbarSlider.hoverBackground": t.ui.scrollbar.hover,
      "scrollbarSlider.activeBackground": t.ui.scrollbar.active,
    },
  });
}

export function EditorTab({ tab }: TabContentProps) {
  const filePath = getEditorMeta(tab)?.filePath;
  const [content, setContent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const dirty = useLayoutStore((s) => s.dirtyTabs.has(tab.id));
  const setTabDirty = useLayoutStore((s) => s.setTabDirty);
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const contentRef = useRef<string | null>(null);
  const versionRef = useRef(0);
  const changeDisposableRef = useRef<{ dispose: () => void } | null>(null);
  const pendingChangesRef = useRef<TextDocumentContentChangeEvent[]>([]);
  const debounceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [editorReady, setEditorReady] = useState(false);
  const lspOpenedRef = useRef(false);

  const editorFontSize = useEditorStore((s) => s.editorFontSize);
  const zoomEditorIn = useEditorStore((s) => s.zoomEditorIn);
  const zoomEditorOut = useEditorStore((s) => s.zoomEditorOut);
  const resetEditorZoom = useEditorStore((s) => s.resetEditorZoom);

  const workspace = useActiveWorkspace();
  const startServer = useLspStore((s) => s.startServer);
  const getClient = useLspStore((s) => s.getClient);
  const lspLanguageRef = useRef<string>("plaintext");

  const fileUri = filePath ? pathToFileUri(filePath) : null;

  const isExternalUpdateRef = useRef(false);

  // Refs to keep cleanup closure in sync with latest values
  const workspaceRef = useRef(workspace);
  workspaceRef.current = workspace;
  const fileUriRef = useRef(fileUri);
  fileUriRef.current = fileUri;
  const filePathRef = useRef(filePath);
  filePathRef.current = filePath;
  const dirtyRef = useRef(dirty);
  dirtyRef.current = dirty;

  const loadFile = useCallback(async () => {
    if (!filePath) return;
    setLoading(true);
    setError(null);
    try {
      const result = await invoke<string>("read_file", { path: filePath });
      setContent(result);
      contentRef.current = result;
      setTabDirty(tab.id, false);
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
      setTabDirty(tab.id, false);

      // Notify LSP of save
      if (workspace && fileUri) {
        const client = getClient(workspace.path, lspLanguageRef.current);
        client?.didSave(fileUri, contentRef.current);
      }
    } catch (e) {
      setError(String(e));
    }
  }, [filePath, workspace, fileUri, getClient]);

  // Sync font size from store to the editor instance
  useEffect(() => {
    editorRef.current?.updateOptions({ fontSize: editorFontSize });
  }, [editorFontSize]);

  // Re-apply Monaco theme when the app theme changes
  const handleThemeChanged = useCallback(() => {
    const monaco = monacoRef.current;
    if (!monaco) return;
    defineKosmosTheme(monaco);
    monaco.editor.setTheme("kosmos");
  }, []);
  useThemeListener(handleThemeChanged);

  // Start LSP when both editor and workspace are ready.
  // Handles the case where workspace loads after the editor mounts (release builds)
  // and the case where the editor mounts after workspace is already available.
  useEffect(() => {
    if (!editorReady || !workspace || !fileUri || !monacoRef.current || !editorRef.current) return;
    if (lspOpenedRef.current) return;

    const lspLang = lspLanguageRef.current;
    let cancelled = false;

    startServer(workspace.path, lspLang, filePath ?? null, monacoRef.current).then((client) => {
      if (cancelled || !client || !editorRef.current) return;
      lspOpenedRef.current = true;
      versionRef.current = 1;
      client.didOpen(fileUri, lspLang, versionRef.current, editorRef.current.getValue());
    });

    return () => {
      cancelled = true;
    };
  }, [editorReady, workspace, fileUri, startServer]);

  // Cleanup on unmount: flush pending changes, didClose, change listener, editor instance.
  // Uses refs to always access the latest workspace/fileUri/filePath values.
  useEffect(() => {
    return () => {
      const ws = workspaceRef.current;
      const uri = fileUriRef.current;
      const fp = filePathRef.current;

      // Clear debounce timer and flush any pending changes before closing
      if (debounceTimerRef.current != null) {
        clearTimeout(debounceTimerRef.current);
        debounceTimerRef.current = null;
      }
      if (pendingChangesRef.current.length > 0 && ws && uri) {
        const client = useLspStore.getState().getClient(ws.path, lspLanguageRef.current);
        if (client) {
          client.didChange(uri, versionRef.current, pendingChangesRef.current);
          pendingChangesRef.current = [];
        }
      }

      lspOpenedRef.current = false;
      changeDisposableRef.current?.dispose();
      useLayoutStore.getState().setTabDirty(tab.id, false);
      if (fp) editorCache.delete(fp);
      if (ws && uri) {
        const client = useLspStore.getState().getClient(ws.path, lspLanguageRef.current);
        client?.didClose(uri);
      }
    };
  }, []);

  // Reload editor content when the file is modified externally and the editor is clean.
  // Uses refs for workspace/fileUri/getClient to keep the listener stable across store updates.
  useEffect(() => {
    if (!filePath) return;

    const unlisten = listen<string[]>("file-content-changed", async (event) => {
      const changedFiles = event.payload;
      // Normalize both paths for comparison (backslash-insensitive)
      const normFilePath = normalizePath(filePath);
      if (!changedFiles.some((f) => normalizePath(f) === normFilePath)) return;

      // Don't reload if the user has unsaved edits
      if (dirtyRef.current) return;

      try {
        const newContent = await invoke<string>("read_file", { path: filePath });
        // Skip if content is identical (e.g. triggered by our own save)
        if (newContent === contentRef.current) return;

        contentRef.current = newContent;
        const ed = editorRef.current;
        if (ed) {
          isExternalUpdateRef.current = true;
          ed.setValue(newContent);
          isExternalUpdateRef.current = false;
        } else {
          setContent(newContent);
        }

        // Notify LSP of the updated content
        const ws = workspaceRef.current;
        const uri = fileUriRef.current;
        if (ws && uri) {
          versionRef.current++;
          const client = useLspStore.getState().getClient(ws.path, lspLanguageRef.current);
          client?.didChange(uri, versionRef.current, [{ text: newContent }]);
        }
      } catch {
        // File may have been deleted — ignore
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [filePath]);

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

    // Signal that the editor is mounted — the LSP useEffect will handle
    // starting the server and sending didOpen when all conditions are met.
    setEditorReady(true);

    // Register editor instance for cross-file navigation
    if (filePath) {
      const cached = editorCache.get(filePath);
      const pendingReveal = cached?.pendingReveal;
      editorCache.set(filePath, { instance, pendingReveal: undefined });
      if (pendingReveal) {
        // Defer reveal — @monaco-editor/react toggles the container from
        // display:none to display:block after onMount, triggering a
        // ResizeObserver → layout() that resets scroll. setTimeout runs
        // after the ResizeObserver callback settles.
        setTimeout(() => {
          instance.setPosition(pendingReveal);
          instance.revealPositionInCenter(pendingReveal);
        }, 50);
      }
    }

    // eslint-disable-next-line no-bitwise
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS, () => saveFile());

    // Zoom keybindings
    // eslint-disable-next-line no-bitwise
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Equal, () => zoomEditorIn());
    // eslint-disable-next-line no-bitwise
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Minus, () => zoomEditorOut());
    // eslint-disable-next-line no-bitwise
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Digit0, () => resetEditorZoom());

    // Listen for content changes and debounce LSP didChange notifications.
    // Sending on every keystroke floods the server; batching with a short
    // delay reduces load while keeping diagnostics responsive.
    const DIDCHANGE_DEBOUNCE_MS = 200;

    changeDisposableRef.current = instance.onDidChangeModelContent((e) => {
      // Update local state immediately (not debounced)
      contentRef.current = instance.getValue();
      // Skip dirty flag for programmatic reloads from external file changes
      if (isExternalUpdateRef.current) return;
      if (!dirty) setTabDirty(tab.id, true);

      if (!workspace || !fileUri) return;
      const client = getClient(workspace.path, lspLanguageRef.current);
      if (!client) return;

      versionRef.current++;

      // Check if server wants full or incremental sync
      const syncKind =
        typeof client.capabilities?.textDocumentSync === "object"
          ? client.capabilities.textDocumentSync.change
          : client.capabilities?.textDocumentSync;

      // Accumulate changes for the debounced send
      if (syncKind === TextDocumentSyncKind.Full) {
        // For full sync, only the latest snapshot matters
        pendingChangesRef.current = [{ text: instance.getValue() }];
      } else {
        // For incremental sync, accumulate all changes in order
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
        pendingChangesRef.current.push(...changes);
      }

      // Debounce the actual send
      if (debounceTimerRef.current != null) {
        clearTimeout(debounceTimerRef.current);
      }
      debounceTimerRef.current = setTimeout(() => {
        debounceTimerRef.current = null;
        if (pendingChangesRef.current.length === 0) return;
        const currentClient = getClient(workspace.path, lspLanguageRef.current);
        if (!currentClient) return;
        currentClient.didChange(fileUri, versionRef.current, pendingChangesRef.current);
        pendingChangesRef.current = [];
      }, DIDCHANGE_DEBOUNCE_MS);
    });
  }

  function handleBeforeMount(monaco: Monaco) {
    monacoRef.current = monaco;
    defineKosmosTheme(monaco);
    setupMonacoLanguages(monaco);
    initExtMap(monaco);
    registerEditorOpener(monaco);

    // Eagerly start the LSP server while Monaco finishes mounting the editor.
    // This overlaps server spawn + initialize with editor DOM setup, so
    // providers are ready sooner. The onMount handler will await the same
    // shared promise and send didOpen once it resolves.
    if (workspace && filePath) {
      const lang = languageIdFromPath(filePath);
      lspLanguageRef.current = lang;
      startServer(workspace.path, lang, filePath, monaco);
    }

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
    return <StateView message="No file path" />;
  }

  if (loading) {
    return <StateView message="Loading..." variant="secondary" />;
  }

  if (error) {
    return <StateView message={error} variant="error" />;
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex-1 min-h-0">
        <Editor
          path={fileUri ?? undefined}
          defaultValue={content ?? ""}
          theme="kosmos"
          beforeMount={handleBeforeMount}
          onMount={handleEditorDidMount}
          options={{
            ...BASE_EDITOR_OPTIONS,
            fontSize: editorFontSize,
            renderLineHighlight: "line",
            cursorBlinking: "smooth",
            cursorSmoothCaretAnimation: "on",
            bracketPairColorization: { enabled: true },
            guides: {
              indentation: true,
              bracketPairs: true,
            },
            hover: { above: false },
          }}
        />
      </div>
    </div>
  );
}
