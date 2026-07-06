/*
 * Client wrapper for the Claude-theme mirror endpoint
 * (iterate-2026-07-06-terminal-theme-modes, FR-01.44).
 *
 * `GET /api/terminal/claude-theme` returns the raw `theme` string persisted
 * in the user's GLOBAL `~/.claude/settings.json`. Used by the default `auto`
 * appearance to mirror whatever theme the user picked in Claude Code.
 * (Project-scoped `.claude/settings.json` override is an explicit follow-up
 * — the endpoint carries no task id, so it resolves the global theme only.)
 * Best-effort: a missing/malformed config yields `{ theme: null }`, never a
 * throw that would blank the terminal.
 *
 * Own module (not externalApi.ts, which sits at its bloat ceiling — see the
 * header note there). Endpoint lives under `/api/terminal/*` alongside the
 * pty WS, but is a plain read (no task id).
 */

import { httpJson } from "./externalApi";

export interface ClaudeThemeResponse {
  /** Raw Claude Code theme string (e.g. "dark", "light-daltonized",
   *  "auto", "custom:dracula"), or null when no config / unreadable. */
  theme: string | null;
}

/** Fetch Claude Code's persisted theme. Never rejects — resolves
 *  `{ theme: null }` on any transport/parse error so callers can fall back
 *  to the OS/dark default without a try/catch at every call site. */
export async function fetchClaudeTheme(): Promise<ClaudeThemeResponse> {
  try {
    return await httpJson<ClaudeThemeResponse>("/api/terminal/claude-theme");
  } catch {
    return { theme: null };
  }
}
