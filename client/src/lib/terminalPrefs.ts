/*
 * Client-local terminal preferences (per-browser, localStorage).
 *
 * iterate-2026-06-30-terminal-paste-single-sink — copy-on-selection
 * (auto-copy a mouse selection straight to the OS clipboard) silently
 * CLOBBERED the user's clipboard right before a right-click paste: you
 * copy something elsewhere, accidentally select terminal text, and the
 * selection overwrites what you were about to paste. With Windows
 * Clipboard History (Win+V) on, the previous entry resurfaces and feels
 * like a "double paste".
 *
 * It is now OPT-IN, default OFF (VS Code parity:
 * `terminal.integrated.copyOnSelection` defaults false). Explicit
 * Ctrl+C / Ctrl+Insert copy (terminal-clipboard.ts) is unaffected.
 *
 * Stored client-side (NOT GlobalSettings) because it is a per-browser UI
 * preference. Reads are LIVE (each selection flush re-reads via
 * `getCopyOnSelection()`), so the Settings toggle takes effect on an
 * already-open terminal with no remount or storage-event plumbing.
 */

import {
  DEFAULT_APPEARANCE_PREF,
  type AppearancePref,
} from "./terminalAppearance";

export const COPY_ON_SELECTION_KEY = "shipwright.terminal.copyOnSelection";

/** Read the live preference. Defaults to `false` (off) and on any error. */
export function getCopyOnSelection(): boolean {
  try {
    return localStorage.getItem(COPY_ON_SELECTION_KEY) === "true";
  } catch {
    // Private-mode / disabled storage — treat as the safe default.
    return false;
  }
}

/** Persist the preference. Non-fatal if storage is unavailable. */
export function setCopyOnSelection(enabled: boolean): void {
  try {
    localStorage.setItem(COPY_ON_SELECTION_KEY, enabled ? "true" : "false");
  } catch {
    /* private mode / storage disabled — non-fatal */
  }
}

/*
 * Terminal appearance preference (iterate-2026-07-06-terminal-theme-modes,
 * FR-01.44). Per-browser like copy-on-selection; the running terminal
 * re-reads it live on change (Settings toggle + a `storage` event) so the
 * open pane re-themes with no remount. Default `auto` = mirror Claude Code.
 */

export const TERMINAL_APPEARANCE_KEY = "shipwright.terminal.appearance";

const VALID_PREFS: readonly AppearancePref[] = [
  "auto",
  "system",
  "light",
  "dark",
];

/** Read the live appearance preference. Defaults to `auto` (mirror Claude)
 *  on missing / malformed values or any storage error. */
export function getAppearancePref(): AppearancePref {
  try {
    const raw = localStorage.getItem(TERMINAL_APPEARANCE_KEY);
    return (VALID_PREFS as readonly string[]).includes(raw ?? "")
      ? (raw as AppearancePref)
      : DEFAULT_APPEARANCE_PREF;
  } catch {
    return DEFAULT_APPEARANCE_PREF;
  }
}

/**
 * Same-tab change signal. The `storage` event only fires in OTHER tabs, so
 * a Settings toggle in the current tab needs an explicit event for the open
 * terminal to re-theme live (cross-tab still rides `storage`).
 */
export const TERMINAL_PREFS_CHANGED_EVENT = "shipwright:terminal-prefs-changed";

/** Persist the appearance preference + emit the same-tab change signal.
 *  Non-fatal if storage is unavailable. */
export function setAppearancePref(pref: AppearancePref): void {
  try {
    localStorage.setItem(TERMINAL_APPEARANCE_KEY, pref);
  } catch {
    /* private mode / storage disabled — non-fatal */
  }
  try {
    window.dispatchEvent(new Event(TERMINAL_PREFS_CHANGED_EVENT));
  } catch {
    /* no window (SSR/test) — non-fatal */
  }
}

/*
 * Claude-theme cache — the last `theme` string the server mirrored from
 * ~/.claude/settings.json. Cached per-browser so the default `auto`
 * appearance resolves SYNCHRONOUSLY at terminal mount (no dark→light flash
 * while the async fetch lands); the fetch then refreshes it.
 */
export const CLAUDE_THEME_CACHE_KEY = "shipwright.terminal.claudeThemeCache";

/** Read the cached Claude theme, or null when unset / unavailable. */
export function getCachedClaudeTheme(): string | null {
  try {
    return localStorage.getItem(CLAUDE_THEME_CACHE_KEY);
  } catch {
    return null;
  }
}

/** Persist (or clear, on null) the cached Claude theme. Non-fatal on error. */
export function setCachedClaudeTheme(theme: string | null): void {
  try {
    if (theme === null) localStorage.removeItem(CLAUDE_THEME_CACHE_KEY);
    else localStorage.setItem(CLAUDE_THEME_CACHE_KEY, theme);
  } catch {
    /* private mode / storage disabled — non-fatal */
  }
}
