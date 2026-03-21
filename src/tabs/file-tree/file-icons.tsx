import type { ComponentType, SVGProps } from "react";
import type { Icon } from "@phosphor-icons/react";
import {
  File,
  FileCode,
  Code,
  FileText,
  FileImage,
  TextAa,
  FileLock,
  Terminal,
} from "@phosphor-icons/react";
import {
  TypeScript,
  JavaScript,
  RustDark,
  RustLight,
  Python,
  GoDark,
  GoLight,
  Ruby,
  Java,
  C as CLang,
  CPlusPlus,
  CSS as CSSIcon,
  Sass,
  HTML5,
  Vue,
  Svelte,
  PhpDark,
  PhpLight,
  Swift,
  Kotlin,
  Lua,
  BashDark,
  BashLight,
  JSON as JSONIcon,
  MarkdownDark,
  MarkdownLight,
  Docker,
  ReactDark,
  ReactLight,
  TailwindCSS,
  Vite,
  Zig,
  Cobol,
  Haskell,
  Scala,
  Dart,
  Julia,
  Fortran,
  Gleam,
  RDark,
  RLight,
  Solidity,
  GraphQL,
  PowerShell,
  AstroDark,
  AstroLight,
  Tauri,
  Bun,
  Vitest,
  Esbuild,
  Angular,
  Nuxt,
  PrismaDark,
  PrismaLight,
  SQLite,
} from "@ridemountainpig/svgl-react";

// ── Types ──

type SvgComponent = ComponentType<SVGProps<SVGSVGElement>>;
type Themed<T> = { dark: T; light: T };
type BrandIcon = SvgComponent | Themed<SvgComponent>;

interface FileIconDef {
  brand?: BrandIcon;
  fallback: Icon;
}

// ── Themed shorthands ──

const themed = (dark: SvgComponent, light: SvgComponent): Themed<SvgComponent> => ({
  dark,
  light,
});

const rust = themed(RustDark, RustLight);
const react = themed(ReactDark, ReactLight);
const go = themed(GoDark, GoLight);
const php = themed(PhpDark, PhpLight);
const bash = themed(BashDark, BashLight);
const markdown = themed(MarkdownDark, MarkdownLight);
const r = themed(RDark, RLight);
const astro = themed(AstroDark, AstroLight);
const prisma = themed(PrismaDark, PrismaLight);

// ── Icon definitions ──

/** Icons resolved by exact filename. */
const BY_NAME: Record<string, FileIconDef> = {
  // Rust
  "Cargo.toml": { brand: rust, fallback: FileCode },
  "Cargo.lock": { brand: rust, fallback: FileLock },

  // JS ecosystem
  "package.json": { brand: JSONIcon, fallback: Code },
  "package-lock.json": { brand: JSONIcon, fallback: FileLock },
  "bun.lock": { brand: Bun, fallback: FileLock },
  "bun.lockb": { brand: Bun, fallback: FileLock },
  "bunfig.toml": { brand: Bun, fallback: Code },
  "deno.json": { fallback: Code },
  "deno.jsonc": { fallback: Code },
  "tsconfig.json": { brand: TypeScript, fallback: Code },

  // Build tools
  "vite.config.ts": { brand: Vite, fallback: FileCode },
  "vite.config.js": { brand: Vite, fallback: FileCode },
  "vitest.config.ts": { brand: Vitest, fallback: FileCode },
  "vitest.config.js": { brand: Vitest, fallback: FileCode },
  "esbuild.config.js": { brand: Esbuild, fallback: FileCode },
  "esbuild.config.ts": { brand: Esbuild, fallback: FileCode },
  "tailwind.config.ts": { brand: TailwindCSS, fallback: FileCode },
  "tailwind.config.js": { brand: TailwindCSS, fallback: FileCode },
  "astro.config.ts": { brand: astro, fallback: FileCode },
  "astro.config.mjs": { brand: astro, fallback: FileCode },
  "nuxt.config.ts": { brand: Nuxt, fallback: FileCode },
  "angular.json": { brand: Angular, fallback: Code },
  "tauri.conf.json": { brand: Tauri, fallback: Code },

  // Prisma
  "schema.prisma": { brand: prisma, fallback: Code },

  // Docker / infra
  Dockerfile: { brand: Docker, fallback: Terminal },
  "docker-compose.yml": { brand: Docker, fallback: Code },
  "docker-compose.yaml": { brand: Docker, fallback: Code },
  Makefile: { fallback: Terminal },
};

/** Icons resolved by file extension. */
const BY_EXT: Record<string, FileIconDef> = {
  // ── Languages ──
  ts: { brand: TypeScript, fallback: FileCode },
  tsx: { brand: react, fallback: FileCode },
  js: { brand: JavaScript, fallback: FileCode },
  jsx: { brand: react, fallback: FileCode },
  mjs: { brand: JavaScript, fallback: FileCode },
  cjs: { brand: JavaScript, fallback: FileCode },
  rs: { brand: rust, fallback: FileCode },
  py: { brand: Python, fallback: FileCode },
  go: { brand: go, fallback: FileCode },
  rb: { brand: Ruby, fallback: FileCode },
  java: { brand: Java, fallback: FileCode },
  c: { brand: CLang, fallback: FileCode },
  cpp: { brand: CPlusPlus, fallback: FileCode },
  cc: { brand: CPlusPlus, fallback: FileCode },
  cxx: { brand: CPlusPlus, fallback: FileCode },
  h: { brand: CLang, fallback: FileCode },
  hpp: { brand: CPlusPlus, fallback: FileCode },
  swift: { brand: Swift, fallback: FileCode },
  kt: { brand: Kotlin, fallback: FileCode },
  kts: { brand: Kotlin, fallback: FileCode },
  lua: { brand: Lua, fallback: FileCode },
  php: { brand: php, fallback: FileCode },
  dart: { brand: Dart, fallback: FileCode },
  zig: { brand: Zig, fallback: FileCode },
  cob: { brand: Cobol, fallback: FileCode },
  cbl: { brand: Cobol, fallback: FileCode },
  cobol: { brand: Cobol, fallback: FileCode },
  hs: { brand: Haskell, fallback: FileCode },
  lhs: { brand: Haskell, fallback: FileCode },
  scala: { brand: Scala, fallback: FileCode },
  sc: { brand: Scala, fallback: FileCode },
  jl: { brand: Julia, fallback: FileCode },
  r: { brand: r, fallback: FileCode },
  R: { brand: r, fallback: FileCode },
  f90: { brand: Fortran, fallback: FileCode },
  f95: { brand: Fortran, fallback: FileCode },
  f03: { brand: Fortran, fallback: FileCode },
  gleam: { brand: Gleam, fallback: FileCode },
  sol: { brand: Solidity, fallback: FileCode },
  gql: { brand: GraphQL, fallback: Code },
  graphql: { brand: GraphQL, fallback: Code },
  astro: { brand: astro, fallback: FileCode },
  prisma: { brand: prisma, fallback: Code },

  // ── Web ──
  html: { brand: HTML5, fallback: FileCode },
  css: { brand: CSSIcon, fallback: FileCode },
  scss: { brand: Sass, fallback: FileCode },
  sass: { brand: Sass, fallback: FileCode },
  vue: { brand: Vue, fallback: FileCode },
  svelte: { brand: Svelte, fallback: FileCode },

  // ── Shell ──
  sh: { brand: bash, fallback: FileCode },
  bash: { brand: bash, fallback: FileCode },
  zsh: { brand: bash, fallback: FileCode },
  ps1: { brand: PowerShell, fallback: FileCode },
  psm1: { brand: PowerShell, fallback: FileCode },

  // ── Data / config ──
  json: { brand: JSONIcon, fallback: Code },
  jsonc: { brand: JSONIcon, fallback: Code },
  toml: { fallback: Code },
  yaml: { fallback: Code },
  yml: { fallback: Code },
  xml: { fallback: Code },
  sql: { brand: SQLite, fallback: Code },
  db: { brand: SQLite, fallback: Code },

  // ── Text / docs ──
  md: { brand: markdown, fallback: FileText },
  mdx: { brand: markdown, fallback: FileText },
  txt: { fallback: FileText },
  log: { fallback: FileText },
  csv: { fallback: FileText },
  rst: { fallback: FileText },
  tex: { fallback: FileText },

  // ── Images ──
  png: { fallback: FileImage },
  jpg: { fallback: FileImage },
  jpeg: { fallback: FileImage },
  gif: { fallback: FileImage },
  svg: { fallback: FileImage },
  ico: { fallback: FileImage },
  webp: { fallback: FileImage },
  bmp: { fallback: FileImage },
  avif: { fallback: FileImage },

  // ── Fonts ──
  ttf: { fallback: TextAa },
  otf: { fallback: TextAa },
  woff: { fallback: TextAa },
  woff2: { fallback: TextAa },

  // ── Lock files ──
  lock: { fallback: FileLock },
};

// ── Public API ──

function resolveBrand(icon: BrandIcon, isDark: boolean): SvgComponent {
  return "dark" in icon ? (isDark ? icon.dark : icon.light) : icon;
}

function resolve(name: string, extension: string | null): FileIconDef {
  return BY_NAME[name] ?? (extension ? BY_EXT[extension] : null) ?? { fallback: File };
}

/** Renders the appropriate icon for a file — brand SVG when available, Phosphor fallback. */
export function FileIcon({
  name,
  extension,
  size,
  className,
  isDark,
}: {
  name: string;
  extension: string | null;
  size: number;
  className?: string;
  isDark: boolean;
}) {
  const def = resolve(name, extension);

  if (def.brand) {
    const Brand = resolveBrand(def.brand, isDark);
    return <Brand width={size} height={size} className={`shrink-0 ${className ?? ""}`} />;
  }

  const Fallback = def.fallback;
  return <Fallback size={size} className={className} />;
}
