/*
 * Terminal appearance resolution (iterate-2026-07-06-terminal-theme-modes,
 * FR-01.44).
 *
 * Pure logic that turns three inputs — the user's per-browser preference,
 * Claude Code's persisted theme (mirrored from ~/.claude/settings.json via
 * `GET /api/terminal/claude-theme`), and the OS light/dark signal — into a
 * single resolved `"light" | "dark"` that `paletteFor()` maps to an xterm
 * ITheme. Kept window-free so it is unit-testable; the impure wrappers that
 * read localStorage / matchMedia live in `terminalPrefs.ts` and
 * `EmbeddedTerminal.tsx`.
 *
 * Precedence (see `resolveAppearance`):
 *   pref = "dark"   → dark
 *   pref = "light"  → light
 *   pref = "system" → OS
 *   pref = "auto"   → mirror Claude Code's theme (light variants→light,
 *                     dark variants→dark, auto→OS), falling back to dark
 *                     for custom/unknown/missing.
 */

import type { ResolvedAppearance } from "../components/terminal/terminal-theme";

/** The user-facing setting persisted per-browser. `auto` = mirror Claude. */
export type AppearancePref = "auto" | "system" | "light" | "dark";

/** Default when nothing is stored: mirror Claude Code. */
export const DEFAULT_APPEARANCE_PREF: AppearancePref = "auto";

/** A Claude theme mapped to a background family, or `"system"` (Claude
 *  `auto`) meaning "defer to the OS signal". */
export type ClaudeThemeFamily = ResolvedAppearance | "system";

/**
 * Map a raw Claude Code `theme` string to a background family.
 *   light / light-daltonized / light-ansi → light
 *   dark  / dark-daltonized  / dark-ansi  → dark
 *   auto                                   → system (defer to OS)
 *   custom:<slug> / unknown / null / ""    → dark (safe default; the user
 *     can still override in Settings)
 *
 * Prefix-based so future `light-*` / `dark-*` variants classify correctly.
 */
export function mapClaudeThemeToFamily(
  theme: string | null | undefined,
): ClaudeThemeFamily {
  if (!theme) return "dark";
  const t = theme.trim().toLowerCase();
  if (t === "auto") return "system";
  if (t === "light" || t.startsWith("light-")) return "light";
  if (t === "dark" || t.startsWith("dark-")) return "dark";
  return "dark";
}

export interface ResolveAppearanceInput {
  /** The user's per-browser preference. */
  pref: AppearancePref;
  /** Raw Claude Code theme string (from the server), or null if unknown. */
  claudeTheme: string | null | undefined;
  /** OS/browser `prefers-color-scheme: dark` signal. */
  systemPrefersDark: boolean;
}

/** Resolve the three inputs to the concrete palette family to render. */
export function resolveAppearance(input: ResolveAppearanceInput): ResolvedAppearance {
  const { pref, claudeTheme, systemPrefersDark } = input;
  const osFamily: ResolvedAppearance = systemPrefersDark ? "dark" : "light";

  switch (pref) {
    case "light":
      return "light";
    case "dark":
      return "dark";
    case "system":
      return osFamily;
    case "auto": {
      const family = mapClaudeThemeToFamily(claudeTheme);
      return family === "system" ? osFamily : family;
    }
    default:
      // Unknown/corrupt stored value — safe default is the historical dark.
      return "dark";
  }
}
