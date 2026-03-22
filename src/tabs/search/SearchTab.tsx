import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { invoke } from "@tauri-apps/api/core";
import { MagnifyingGlass, File, TextT, ArrowElbowDownLeft } from "@phosphor-icons/react";
import MonacoEditor, { type Monaco } from "@monaco-editor/react";
import type { editor } from "monaco-editor";
import { useActiveWorkspace } from "../../contexts/WorkspaceContext";
import { useLayoutStore } from "../../store/layout.store";
import { revealPosition, defineKosmosTheme } from "../editor/EditorTab";
import { useEditorStore } from "../../store/editor.store";
import { setupMonacoLanguages, resolveModelLanguage } from "../../lib/lsp/monaco-languages";
import { pathToFileUri } from "../../lib/lsp/uri";
import { ScrollArea } from "../../components/shared/ScrollArea";
import type { TabContentProps } from "../types";

type SearchMode = "files" | "content";

interface FileResult {
  path: string;
  score: number;
  indices: number[];
}

interface ContentResult {
  path: string;
  line: number;
  col: number;
  text: string;
}

// ── Fuzzy matcher ──

function fuzzyMatch(query: string, target: string): { score: number; indices: number[] } | null {
  const qLower = query.toLowerCase();
  const tLower = target.toLowerCase();

  let qi = 0;
  const indices: number[] = [];

  for (let i = 0; i < target.length && qi < query.length; i++) {
    if (tLower[i] === qLower[qi]) {
      indices.push(i);
      qi++;
    }
  }

  if (qi !== query.length) return null;

  let score = 0;
  for (let i = 0; i < indices.length; i++) {
    const idx = indices[i];
    if (i > 0 && idx === indices[i - 1] + 1) score += 10;
    if (idx === 0 || "/.-_ \\".includes(target[idx - 1])) score += 5;
    if (target[idx] === query[i]) score += 1;
  }
  score -= target.length * 0.1;
  const lastSlash = target.lastIndexOf("/");
  if (lastSlash >= 0 && indices[0] > lastSlash) score += 8;

  return { score, indices };
}

// ── Highlighted text (fuzzy match indices) ──

function HighlightedPath({ text, indices }: { text: string; indices: number[] }) {
  const set = new Set(indices);
  const parts: { text: string; highlighted: boolean }[] = [];
  let current = "";
  let isHighlighted = set.has(0);

  for (let i = 0; i < text.length; i++) {
    const h = set.has(i);
    if (h !== isHighlighted) {
      if (current) parts.push({ text: current, highlighted: isHighlighted });
      current = "";
      isHighlighted = h;
    }
    current += text[i];
  }
  if (current) parts.push({ text: current, highlighted: isHighlighted });

  return (
    <span className="truncate">
      {parts.map((p, i) =>
        p.highlighted ? (
          <span key={i} className="text-[var(--color-accent-blue)] font-semibold">
            {p.text}
          </span>
        ) : (
          <span key={i}>{p.text}</span>
        ),
      )}
    </span>
  );
}

// ── File preview panel (Monaco read-only) ──

function FilePreview({
  filePath,
  matchLine,
  query,
}: {
  filePath: string;
  matchLine: number;
  query: string;
}) {
  const editorRef = useRef<editor.IStandaloneCodeEditor | null>(null);
  const monacoRef = useRef<Monaco | null>(null);
  const decorationsRef = useRef<editor.IEditorDecorationsCollection | null>(null);
  const matchLineRef = useRef(matchLine);
  const queryRef = useRef(query);
  matchLineRef.current = matchLine;
  queryRef.current = query;
  const editorFontSize = useEditorStore((s) => s.editorFontSize);
  const [ready, setReady] = useState(false);

  function applyDecorations(ed: editor.IStandaloneCodeEditor, line: number, q: string) {
    decorationsRef.current?.clear();
    const decorations: editor.IModelDeltaDecoration[] = [
      {
        range: { startLineNumber: line, startColumn: 1, endLineNumber: line, endColumn: 1 },
        options: { isWholeLine: true, className: "search-match-line-highlight" },
      },
    ];

    if (q) {
      const model = ed.getModel();
      if (model && line <= model.getLineCount()) {
        const lineContent = model.getLineContent(line);
        const col = lineContent.toLowerCase().indexOf(q.toLowerCase());
        if (col !== -1) {
          decorations.push({
            range: {
              startLineNumber: line,
              startColumn: col + 1,
              endLineNumber: line,
              endColumn: col + 1 + q.length,
            },
            options: { inlineClassName: "search-match-text-highlight" },
          });
        }
      }
    }

    decorationsRef.current = ed.createDecorationsCollection(decorations);
    ed.revealLineInCenter(line);
  }

  // Load file and swap model when filePath changes, then apply decorations
  useEffect(() => {
    const ed = editorRef.current;
    const monaco = monacoRef.current;
    if (!ed || !monaco || !ready) return;

    let cancelled = false;

    invoke<string>("read_file", { path: filePath })
      .then((content) => {
        if (cancelled) return;
        const uri = monaco.Uri.parse(pathToFileUri(filePath));
        let model = monaco.editor.getModel(uri);
        if (model) {
          model.setValue(content);
        } else {
          model = monaco.editor.createModel(content, undefined, uri);
        }
        ed.setModel(model);
        resolveModelLanguage(monaco, model);
        applyDecorations(ed, matchLineRef.current, queryRef.current);
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [filePath, ready]);

  // Update decorations when matchLine/query changes (same file)
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed || !ready) return;
    applyDecorations(ed, matchLine, query);
  }, [matchLine, query, ready]);

  function handleBeforeMount(monaco: Monaco) {
    defineKosmosTheme(monaco);
    setupMonacoLanguages(monaco);
  }

  function handleMount(instance: editor.IStandaloneCodeEditor, monaco: Monaco) {
    editorRef.current = instance;
    monacoRef.current = monaco;
    setReady(true);
  }

  // Dispose preview models on unmount
  useEffect(() => {
    return () => {
      editorRef.current?.getModel()?.dispose();
    };
  }, []);

  return (
    <MonacoEditor
      theme="kosmos"
      beforeMount={handleBeforeMount}
      onMount={handleMount}
      options={{
        readOnly: true,
        fontFamily: "'JetBrains Mono', monospace",
        fontSize: editorFontSize,
        lineHeight: 1.6,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        padding: { top: 12 },
        renderLineHighlight: "none",
        smoothScrolling: true,
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
        domReadOnly: true,
      }}
    />
  );
}

// ── Main component ──

export function SearchTab({ tab: _tab, paneId }: TabContentProps) {
  const [mode, setMode] = useState<SearchMode>("files");
  const [query, setQuery] = useState("");
  const [allFiles, setAllFiles] = useState<string[]>([]);
  const [contentResults, setContentResults] = useState<ContentResult[]>([]);
  const [contentLoading, setContentLoading] = useState(false);
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const contentTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const activeWorkspace = useActiveWorkspace();

  // Load all files when workspace changes
  useEffect(() => {
    if (!activeWorkspace) return;
    invoke<string[]>("list_workspace_files", { path: activeWorkspace.path })
      .then(setAllFiles)
      .catch((e) => console.warn("Failed to list files:", e));
  }, [activeWorkspace?.path]);

  // Auto-focus input on mount
  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 0);
  }, []);

  // Fuzzy file results — match against filename only
  const fileResults: FileResult[] = useMemo(() => {
    if (mode !== "files" || !query.trim()) return [];
    const matches: FileResult[] = [];
    for (const path of allFiles) {
      const fileName = path.split("/").pop() ?? path;
      const m = fuzzyMatch(query, fileName);
      if (m) {
        const nameOffset = path.length - fileName.length;
        matches.push({
          path,
          score: m.score,
          indices: m.indices.map((i) => i + nameOffset),
        });
      }
    }
    matches.sort((a, b) => b.score - a.score);
    return matches.slice(0, 50);
  }, [mode, query, allFiles]);

  // Content search with debounce
  useEffect(() => {
    if (mode !== "content") return;
    if (contentTimerRef.current) clearTimeout(contentTimerRef.current);

    if (!query.trim() || !activeWorkspace) {
      setContentResults([]);
      setContentLoading(false);
      return;
    }

    setContentLoading(true);
    contentTimerRef.current = setTimeout(() => {
      invoke<ContentResult[]>("search_in_files", {
        path: activeWorkspace.path,
        query: query.trim(),
        maxResults: 100,
      })
        .then((results) => {
          setContentResults(results);
          setContentLoading(false);
          setSelectedIndex(0);
        })
        .catch((e) => {
          console.warn("Content search failed:", e);
          setContentLoading(false);
        });
    }, 300);

    return () => {
      if (contentTimerRef.current) clearTimeout(contentTimerRef.current);
    };
  }, [mode, query, activeWorkspace?.path]);

  // Reset selected index when results change
  useEffect(() => {
    setSelectedIndex(0);
  }, [fileResults.length, contentResults.length]);

  const resultCount = (mode === "files" ? fileResults : contentResults).length;

  // Currently selected content result for preview
  const selectedContent =
    mode === "content" && contentResults.length > 0 ? contentResults[selectedIndex] : null;

  // Full path for preview
  const previewPath = useMemo(() => {
    if (!selectedContent || !activeWorkspace) return null;
    return `${activeWorkspace.path}/${selectedContent.path}`.replace(/\//g, "\\");
  }, [selectedContent, activeWorkspace]);

  // Open file handler
  const openFile = useCallback(
    (filePath: string) => {
      if (!activeWorkspace) return;
      const fullPath = `${activeWorkspace.path}/${filePath}`.replace(/\//g, "\\");
      const fileName = filePath.split("/").pop() ?? filePath;
      useLayoutStore.getState().openFile(fullPath, fileName, paneId);
    },
    [activeWorkspace, paneId],
  );

  const handleSelect = useCallback(
    (index: number) => {
      if (mode === "files") {
        const r = fileResults[index];
        if (r) openFile(r.path);
      } else {
        const r = contentResults[index];
        if (r) {
          openFile(r.path);
          if (!activeWorkspace) return;
          const fullPath = `${activeWorkspace.path}/${r.path}`.replace(/\//g, "\\");
          revealPosition(fullPath, { lineNumber: r.line, column: r.col });
        }
      }
    },
    [mode, fileResults, contentResults, openFile, activeWorkspace],
  );

  // Keyboard navigation
  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "ArrowDown") {
        e.preventDefault();
        setSelectedIndex((i) => Math.min(i + 1, resultCount - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setSelectedIndex((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        handleSelect(selectedIndex);
      } else if (e.key === "Tab") {
        e.preventDefault();
        setMode((m) => (m === "files" ? "content" : "files"));
        setSelectedIndex(0);
      }
    },
    [resultCount, selectedIndex, handleSelect],
  );

  // Scroll selected item into view
  useEffect(() => {
    const item = listRef.current?.querySelector(`[data-index="${selectedIndex}"]`);
    item?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  if (!activeWorkspace) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-xs text-[var(--color-text-muted)]">No workspace open</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full font-ui">
      {/* Input area */}
      <div className="flex items-center gap-2 px-3 h-11 shrink-0 border-b border-[var(--color-border-primary)]">
        <MagnifyingGlass size={15} className="text-[var(--color-text-muted)] shrink-0" />
        <input
          ref={inputRef}
          type="text"
          className="flex-1 bg-transparent text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] focus:outline-none"
          placeholder={mode === "files" ? "Search files by name..." : "Search in file contents..."}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />
        {mode === "content" && contentResults.length > 0 && (
          <span className="text-[11px] text-[var(--color-text-muted)] shrink-0 font-mono">
            {selectedIndex + 1} / {contentResults.length}
          </span>
        )}
      </div>

      {/* Mode tabs */}
      <div className="flex items-center shrink-0 border-b border-[var(--color-border-primary)]">
        <button
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium transition-colors cursor-pointer ${
            mode === "files"
              ? "text-[var(--color-accent-blue)] border-b-2 border-[var(--color-accent-blue)]"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
          }`}
          onClick={() => {
            setMode("files");
            setSelectedIndex(0);
            inputRef.current?.focus();
          }}
        >
          <File size={12} />
          Files
        </button>
        <button
          className={`flex items-center gap-1.5 px-3 py-1.5 text-[11px] font-medium transition-colors cursor-pointer ${
            mode === "content"
              ? "text-[var(--color-accent-blue)] border-b-2 border-[var(--color-accent-blue)]"
              : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
          }`}
          onClick={() => {
            setMode("content");
            setSelectedIndex(0);
            inputRef.current?.focus();
          }}
        >
          <TextT size={12} />
          Content
        </button>
        <div className="flex-1" />
        <span className="text-[10px] text-[var(--color-text-muted)] px-3">Tab to switch</span>
      </div>

      {/* Results area */}
      {mode === "files" ? (
        /* ── File search: single list ── */
        <ScrollArea className="flex-1 min-h-0">
          <div ref={listRef}>
            {!query.trim() ? (
              <div className="px-4 py-6 text-xs text-[var(--color-text-muted)] text-center">
                Type to search for files...
              </div>
            ) : fileResults.length === 0 ? (
              <div className="px-4 py-6 text-xs text-[var(--color-text-muted)] text-center">
                No files found
              </div>
            ) : (
              <div className="py-1">
                {fileResults.map((r, i) => (
                  <button
                    key={r.path}
                    data-index={i}
                    className={`w-full text-left px-3 py-1.5 flex items-center gap-2.5 cursor-pointer transition-colors ${
                      i === selectedIndex
                        ? "bg-[var(--color-bg-input)]"
                        : "hover:bg-[var(--color-bg-surface)]"
                    }`}
                    onClick={() => handleSelect(i)}
                    onMouseEnter={() => setSelectedIndex(i)}
                  >
                    <File size={14} className="text-[var(--color-text-muted)] shrink-0" />
                    <div className="flex flex-col min-w-0 flex-1">
                      <span className="text-[12px] text-[var(--color-text-primary)] font-medium truncate">
                        {r.path.split("/").pop()}
                      </span>
                      <span className="text-[10px] text-[var(--color-text-tertiary)]">
                        <HighlightedPath text={r.path} indices={r.indices} />
                      </span>
                    </div>
                    {i === selectedIndex && (
                      <ArrowElbowDownLeft
                        size={12}
                        className="text-[var(--color-text-muted)] shrink-0"
                      />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </ScrollArea>
      ) : (
        /* ── Content search: results list + file preview ── */
        <div className="flex flex-1 min-h-0">
          {/* Results list */}
          <div className="flex flex-col w-1/2 min-w-0 border-r border-[var(--color-border-primary)]">
            <ScrollArea className="flex-1 min-h-0">
              <div ref={listRef}>
                {!query.trim() ? (
                  <div className="px-4 py-6 text-xs text-[var(--color-text-muted)] text-center">
                    Type to search in file contents...
                  </div>
                ) : contentLoading ? (
                  <div className="px-4 py-6 text-xs text-[var(--color-text-muted)] text-center">
                    Searching...
                  </div>
                ) : contentResults.length === 0 ? (
                  <div className="px-4 py-6 text-xs text-[var(--color-text-muted)] text-center">
                    No matches found
                  </div>
                ) : (
                  <div className="py-1">
                    {contentResults.map((r, i) => (
                      <button
                        key={`${r.path}:${r.line}:${r.col}`}
                        data-index={i}
                        className={`w-full text-left px-3 py-1.5 flex items-center gap-2.5 cursor-pointer transition-colors ${
                          i === selectedIndex
                            ? "bg-[var(--color-bg-input)]"
                            : "hover:bg-[var(--color-bg-surface)]"
                        }`}
                        onClick={() => handleSelect(i)}
                        onMouseEnter={() => setSelectedIndex(i)}
                      >
                        <File size={14} className="text-[var(--color-text-muted)] shrink-0" />
                        <div className="flex flex-col min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="text-[12px] text-[var(--color-text-primary)] font-medium truncate">
                              {r.path.split("/").pop()}
                            </span>
                            <span className="text-[10px] text-[var(--color-text-muted)]">
                              :{r.line}
                            </span>
                          </div>
                          <span className="text-[10px] text-[var(--color-text-tertiary)] truncate">
                            {r.path}
                          </span>
                        </div>
                        {i === selectedIndex && (
                          <ArrowElbowDownLeft
                            size={12}
                            className="text-[var(--color-text-muted)] shrink-0"
                          />
                        )}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </ScrollArea>
          </div>

          {/* File preview */}
          <div className="flex-1 min-w-0">
            {previewPath && selectedContent ? (
              <FilePreview filePath={previewPath} matchLine={selectedContent.line} query={query} />
            ) : (
              <div className="flex items-center justify-center h-full text-xs text-[var(--color-text-muted)]">
                Select a result to preview
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
