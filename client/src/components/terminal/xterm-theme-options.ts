/*
 * xterm-theme-options — the embedded terminal's ITheme + constructor-options
 * builders (split out of xtermAddons.ts, iterate-2026-07-06-terminal-theme-
 * modes / FR-01.44, to keep both files under the 300-LOC guideline and give
 * the live re-theme hook a focused import).
 *
 * `buildXtermTheme(appearance)` is the single source of truth for the xterm
 * `ITheme` — used at mount (via `buildEmbeddedXtermOptions`) AND on a live
 * appearance change (`useTerminalAppearance` → `term.options.theme =
 * buildXtermTheme(next)`), so both paths produce the identical object shape
 * (VS Code's `_updateTheme` pattern: reassign a fresh ITheme; the WebGL
 * addon repaints itself via `onChangeColors`).
 *
 * `appearance` defaults to `"dark"` so the no-arg path is byte-identical to
 * the pre-light-support behavior (AC-2: the whole DARK render is unchanged).
 */

import type { ITerminalOptions, ITheme } from "@xterm/xterm";

import { paletteFor, type ResolvedAppearance } from "./terminal-theme";

/**
 * Resolve a CSS variable from the document body, falling back to the static
 * palette literal. Keeps the brand-var-aware tokens (--color-error,
 * --color-success, …) threading through for the dark palette.
 */
function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.body).getPropertyValue(name).trim();
  return v.length > 0 ? v : fallback;
}

/**
 * Build the xterm `ITheme` for a resolved appearance. The brand cssVar
 * overrides apply ONLY to the dark palette — the brand accent colors are
 * tuned for the dark bg; on LIGHT we use the WCAG-tuned literals directly.
 */
export function buildXtermTheme(
  appearance: ResolvedAppearance = "dark",
): ITheme {
  const palette = paletteFor(appearance);
  // Brand semantics flow through CSS-vars for the dark palette only.
  const brand = (name: string, fallback: string): string =>
    appearance === "dark" ? cssVar(name, fallback) : fallback;
  return {
    background: palette.background,
    foreground: palette.foreground,
    cursor: palette.cursor,
    cursorAccent: palette.cursorAccent,
    selectionBackground: palette.selectionBackground,
    black: palette.black,
    red: palette.red,
    green: palette.green,
    yellow: palette.yellow,
    blue: palette.blue,
    magenta: palette.magenta,
    cyan: palette.cyan,
    white: palette.white,
    brightBlack: palette.brightBlack,
    brightRed: brand("--color-error", palette.brightRed),
    brightGreen: brand("--color-success", palette.brightGreen),
    brightYellow: brand("--color-warning", palette.brightYellow),
    brightBlue: brand("--color-info", palette.brightBlue),
    brightMagenta: brand("--color-purple", palette.brightMagenta),
    brightCyan: palette.brightCyan,
    brightWhite: palette.brightWhite,
  };
}

/**
 * Build the Terminal constructor options. Exported separately from
 * `createEmbeddedXterm` so a test can capture the options object without a
 * working DOM container (the `EmbeddedTerminal.test.tsx` "terminal options —
 * VS Code parity" block captures via the `vi.mock("@xterm/xterm")` factory).
 */
export function buildEmbeddedXtermOptions(
  appearance: ResolvedAppearance = "dark",
): ITerminalOptions {
  return {
    // convertEol — MUST stay false (CLAUDE.md rule 22, Bug B fence).
    // ConPTY + Claude Code's TUI emit bare LF as "cursor down, keep
    // column"; convertEol:true would yank to col 0 and smear the
    // kept-column content.
    convertEol: false,
    cursorBlink: true,
    fontFamily:
      'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace',
    fontSize: 13,
    theme: buildXtermTheme(appearance),
    scrollback: 10000,
    allowProposedApi: true,
    // ADR-099 — rescale glyphs that exceed cell width so they don't bleed
    // into the next cell. xterm 6.0's default is `false` (documented as a
    // real bug in xtermjs/xterm.js#5100); VS Code sets it via terminal
    // configuration setting `terminal.integrated.rescaleOverlappingGlyphs`
    // which defaults to `true`.
    rescaleOverlappingGlyphs: true,
    // VS Code-parity selection knobs (iterate-2026-05-23 terminal-
    // selection-uxd). References: src/vs/workbench/contrib/terminal/
    // browser/xterm/xtermTerminal.ts:226-275 + terminalConfiguration.ts
    // `terminalWordSeparators` default.
    rightClickSelectsWord: true,
    macOptionClickForcesSelection: true,
    wordSeparator: " ()[]{}',\"`|;:!?",
  };
}
