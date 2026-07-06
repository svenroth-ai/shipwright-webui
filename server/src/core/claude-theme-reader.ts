/*
 * Claude Code theme reader (iterate-2026-07-06-terminal-theme-modes,
 * FR-01.44).
 *
 * Reads the `theme` string the user picked in Claude Code (via `/theme`)
 * from their global `~/.claude/settings.json`, so the embedded terminal's
 * default `auto` appearance can MIRROR it (light theme → light terminal
 * bg, else Claude's dark text renders black-on-black). Read-only — webui
 * never writes Claude's config (DO-NOT guard #1).
 *
 * Best-effort by contract: a missing file, unreadable file, non-JSON body,
 * or absent/non-string `theme` all resolve to `null` (never throw). The
 * only surface is `GET /api/terminal/claude-theme` (routes/terminal-
 * appearance.ts), which must not 500 on a user with no Claude config.
 *
 * Scope: GLOBAL `~/.claude/settings.json` only. Claude Code also supports
 * project-scoped `.claude/settings.json` overrides, but the common case is
 * the global `/theme` setting; project-scope is an explicit follow-up (see
 * the iterate spec "Out of scope").
 */

import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export interface ClaudeThemeReaderDeps {
  /** Injected for tests; defaults to fs/promises.readFile + utf-8. */
  readFile?: (path: string) => Promise<string>;
  /** Injected for tests; defaults to os.homedir(). */
  homedir?: () => string;
}

/** Absolute path to the user's global Claude Code settings file. */
export function claudeSettingsPath(home: string): string {
  return join(home, ".claude", "settings.json");
}

/**
 * Read the persisted Claude Code theme string, or `null` when it can't be
 * determined. Swallows every error (ENOENT, EACCES, malformed JSON, wrong
 * type) — the caller treats `null` as "unknown → fall back to OS/dark".
 */
export async function readClaudeTheme(
  deps: ClaudeThemeReaderDeps = {},
): Promise<string | null> {
  const home = (deps.homedir ?? homedir)();
  const fsRead = deps.readFile ?? ((p: string) => readFile(p, "utf-8"));
  try {
    const raw = await fsRead(claudeSettingsPath(home));
    const parsed: unknown = JSON.parse(raw);
    if (
      parsed &&
      typeof parsed === "object" &&
      "theme" in parsed &&
      typeof (parsed as { theme: unknown }).theme === "string"
    ) {
      const theme = (parsed as { theme: string }).theme.trim();
      return theme.length > 0 ? theme : null;
    }
    return null;
  } catch {
    return null;
  }
}
