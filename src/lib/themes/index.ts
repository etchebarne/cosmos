import type { Theme } from "./types";
import { cosmosDark } from "./cosmos-dark";
import { cosmosLight } from "./cosmos-light";
import { cosmosEmber } from "./cosmos-ember";

export type { Theme } from "./types";

const themes: Record<string, Theme> = {
  "cosmos-dark": cosmosDark,
  "cosmos-light": cosmosLight,
  "cosmos-ember": cosmosEmber,
};

let activeTheme: Theme = cosmosDark;

/** Apply a theme: sets CSS variables on :root and updates the active reference. */
export function applyTheme(name: string) {
  const theme = themes[name];
  if (!theme) return;
  activeTheme = theme;

  const vars: Record<string, string> = {
    "--color-bg-page": theme.ui.bg.page,
    "--color-bg-surface": theme.ui.bg.surface,
    "--color-bg-elevated": theme.ui.bg.elevated,
    "--color-bg-input": theme.ui.bg.input,
    "--color-bg-hover": theme.ui.bg.hover,
    "--color-bg-primary": theme.ui.bg.primary,
    "--color-bg-tertiary": theme.ui.bg.tertiary,
    "--color-project-bar-bg": theme.ui.bg.projectBar,
    "--color-tab-active-bg": theme.ui.bg.tabActive,
    "--color-tab-inactive-bg": theme.ui.bg.tabInactive,
    "--color-text-primary": theme.ui.text.primary,
    "--color-text-secondary": theme.ui.text.secondary,
    "--color-text-tertiary": theme.ui.text.tertiary,
    "--color-text-muted": theme.ui.text.muted,
    "--color-border-primary": theme.ui.border.primary,
    "--color-border-secondary": theme.ui.border.secondary,
    "--color-divider": theme.ui.border.divider,
    "--color-accent-blue": theme.ui.accent.blue,
    "--color-accent-blue-hover": theme.ui.accent.blueHover,
    "--color-accent-blue-muted": theme.ui.accent.blueMuted,
    "--color-status-red": theme.ui.status.red,
    "--color-status-green": theme.ui.status.green,
    "--color-status-amber": theme.ui.status.amber,
    "--color-scrollbar-track": theme.ui.scrollbar.track,
    "--color-scrollbar-hover": theme.ui.scrollbar.hover,
    "--color-scrollbar-active": theme.ui.scrollbar.active,
  };

  const root = document.documentElement;
  for (const [key, value] of Object.entries(vars)) {
    root.style.setProperty(key, value);
  }

  window.dispatchEvent(new CustomEvent("theme-changed"));
}

/** Get the currently active theme object. */
export function getTheme(): Theme {
  return activeTheme;
}

/** Get list of available theme names. */
export function getThemeNames(): string[] {
  return Object.keys(themes);
}
