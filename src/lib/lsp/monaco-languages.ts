import type { Monaco } from "@monaco-editor/react";
import type { editor, languages } from "monaco-editor";
import {
  conf as tsConf,
  language as tsLanguage,
} from "monaco-editor/esm/vs/basic-languages/typescript/typescript";

/**
 * Build a Monarch tokenizer for JSX/TSX by extending the base TypeScript
 * grammar with rules that distinguish intrinsic HTML elements (<div>)
 * from component elements (<MyComponent>).
 *
 * Intrinsic (lowercase) tag names get the "tag" token type so the theme
 * can color them differently. Keywords that appear after `<` in generics
 * (e.g. Array<number>) are excluded via the @keywords guard.
 */
function createJsxTokenizer(tokenPostfix: string): languages.IMonarchLanguage {
  const lang = structuredClone(tsLanguage);
  lang.tokenPostfix = tokenPostfix;

  const root = lang.tokenizer.root as unknown[];
  const tagAction = { cases: { "@keywords": "keyword", "@default": "tag" } };

  root.unshift(
    [/(<\/)([a-z][\w$-]*)/, ["delimiter", tagAction]],
    [/(<)([a-z][\w$-]*)/, ["delimiter", tagAction]],
  );

  return lang;
}

// Languages that standalone Monaco doesn't register separately.
// Each entry shares a Monarch tokenizer with an existing language
// but needs its own ID so the LSP receives the correct languageId
// in textDocument/didOpen (e.g. "typescriptreact" → ScriptKind.TSX).
const ADDITIONAL_LANGUAGES = [
  {
    id: "typescriptreact",
    extensions: [".tsx"],
    conf: tsConf,
    language: createJsxTokenizer(".tsx"),
  },
  {
    id: "javascriptreact",
    extensions: [".jsx"],
    conf: tsConf,
    language: createJsxTokenizer(".jsx"),
  },
];

let registered = false;

/**
 * Register additional languages in Monaco that aren't part of the
 * default standalone distribution. Call once before models are created
 * (e.g. in the Editor's beforeMount callback). Idempotent.
 */
export function setupMonacoLanguages(monaco: Monaco): void {
  if (registered) return;
  registered = true;

  for (const lang of ADDITIONAL_LANGUAGES) {
    if (
      monaco.languages
        .getLanguages()
        .some((l: languages.ILanguageExtensionPoint) => l.id === lang.id)
    )
      continue;

    monaco.languages.register({ id: lang.id, extensions: lang.extensions });
    monaco.languages.setMonarchTokensProvider(lang.id, lang.language);
    monaco.languages.setLanguageConfiguration(lang.id, lang.conf);
  }
}

/**
 * Ensure the model uses the most specific registered language for its
 * file extension. Standalone Monaco maps both .ts and .tsx to
 * "typescript"; after we register "typescriptreact" (with only .tsx),
 * this function picks the tighter match.
 *
 * When multiple languages claim the same extension, the one with
 * fewer total extensions is more specific (e.g. typescriptreact[.tsx]
 * beats typescript[.ts, .tsx, .cts, .mts]).
 */
export function resolveModelLanguage(monaco: Monaco, model: editor.ITextModel): void {
  const uri = model.uri.toString();
  const extMatch = uri.match(/\.([^./?#]+)(?:[?#]|$)/);
  if (!extMatch) return;

  const ext = "." + extMatch[1].toLowerCase();
  const candidates = monaco.languages
    .getLanguages()
    .filter((l: languages.ILanguageExtensionPoint) => l.extensions?.includes(ext));

  if (candidates.length <= 1) return;

  // Most specific = fewest registered extensions
  candidates.sort(
    (a: languages.ILanguageExtensionPoint, b: languages.ILanguageExtensionPoint) =>
      (a.extensions?.length ?? 0) - (b.extensions?.length ?? 0),
  );

  const best = candidates[0].id;
  if (best !== model.getLanguageId()) {
    monaco.editor.setModelLanguage(model, best);
  }
}
