/// <reference types="vite/client" />

// Monaco's internal Monarch language definitions have no public .d.ts.
// We declare the TypeScript module so we can reuse its tokenizer for
// typescriptreact / javascriptreact without @ts-expect-error imports.
declare module "monaco-editor/esm/vs/basic-languages/typescript/typescript" {
  import type { languages } from "monaco-editor";
  export const conf: languages.LanguageConfiguration;
  export const language: languages.IMonarchLanguage;
}
