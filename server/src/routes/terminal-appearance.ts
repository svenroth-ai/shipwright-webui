/*
 * Terminal appearance route (iterate-2026-07-06-terminal-theme-modes,
 * FR-01.44).
 *
 * `GET /api/terminal/claude-theme` → `{ theme: string | null }` — the raw
 * theme the user selected in Claude Code, mirrored from
 * `~/.claude/settings.json` so the embedded terminal's default `auto`
 * appearance can track it. Standalone module (NOT terminal/routes.ts, which
 * is at its ADR-103 bloat ceiling); mounted BEFORE createTerminalRoutes in
 * index.ts. No collision with the `/api/terminal/:taskId/<verb>` pty routes
 * — `claude-theme` is a single trailing segment, and those routes all carry
 * a `:taskId` plus a verb sub-segment.
 *
 * Read-only, best-effort: the reader never throws, so this route always
 * 200s (with `theme: null` when no Claude config exists).
 */

import { Hono } from "hono";
import { readClaudeTheme } from "../core/claude-theme-reader.js";

export interface TerminalAppearanceRouteDeps {
  /** Injected for tests; defaults to the real reader. */
  readClaudeTheme?: () => Promise<string | null>;
}

export function createTerminalAppearanceRoutes(
  deps: TerminalAppearanceRouteDeps = {},
): Hono {
  const app = new Hono();
  const read = deps.readClaudeTheme ?? (() => readClaudeTheme());

  app.get("/api/terminal/claude-theme", async (c) => {
    const theme = await read();
    return c.json({ theme });
  });

  return app;
}
