/*
 * Client-local terminal preferences (per-browser, localStorage).
 *
 * Terminal APPEARANCE (light/dark, iterate-2026-07-06-terminal-theme-modes,
 * FR-01.44) + the Claude-theme cache. Stored client-side (NOT GlobalSettings)
 * because they are per-browser UI preferences; the running terminal re-reads
 * them live on change (Settings toggle + a `storage` event) so the open pane
 * re-themes with no remount.
 *
 * (The former copy-on-selection preference was removed in
 * iterate-2026-07-07-terminal-osc52-clipboard, when OSC 52 became the SOLE
 * terminal copy path — Claude copies its own selection via OSC 52 and the
 * WebUI relays it; see terminal-osc52.ts.)
 */

import {
  DEFAULT_APPEARANCE_PREF,
  type AppearancePref,
} from "./terminalAppearance";

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
