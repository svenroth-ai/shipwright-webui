/*
 * xtermAddons — Terminal + paired addons factory (Campaign C / C5 split).
 *
 * Extracted from EmbeddedTerminal.tsx (iterate-2026-05-26-campaign-C-C5).
 * Behaviour bit-perfect with the source: same Terminal constructor options,
 * same WebGL-before-open ordering (ADR-099), same post-dispose dimensions-
 * stub guard (ADR-084).
 *
 * Exports:
 *   - `createEmbeddedXterm(container)` — pure factory; constructs Terminal,
 *     loads addons in the documented order, opens the canvas, returns
 *     `{ term, fit, dispose }`. ZERO React imports — testable as a unit.
 *
 *   - `XTERM_PIN` — the exact-pinned version literals (CLAUDE.md rule 22).
 *     Verified at vitest time against `client/package.json` so a future
 *     `npm install` that lets a caret range slip through fails loud at
 *     test, not silently at runtime. (Plan-review openai #4+#5 MED:
 *     test-only, NOT a runtime import-time throw.)
 *
 * CLAUDE.md rule 22 invariants enforced here:
 *   - `convertEol: false` (Bug B regression fence — memory
 *     `project_bug_b_remount_smear_writerace`).
 *   - NO `windowsMode` option (removed in xterm 6.x).
 *   - `rescaleOverlappingGlyphs: true` (ADR-099).
 *   - `allowProposedApi: true` (ADR-093).
 *   - `scrollback: 10000`.
 *   - selection knobs (rightClickSelectsWord, macOptionClickForcesSelection,
 *     wordSeparator) from VS Code parity (iterate-2026-05-23 terminal-
 *     selection-uxd).
 *
 * WebGL load order is BEFORE `term.open(container)` per ADR-099 +
 * xtermjs/xterm.js canonical demo. Loading AFTER open() lets the DOM
 * renderer initialise first; it then has to be torn down and swapped
 * mid-paint, leaking partial-redraw state into Claude TUI's alt-screen.
 */

import { Terminal, type ITerminalOptions } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import { WebglAddon } from "@xterm/addon-webgl";
import "@xterm/xterm/css/xterm.css";

import { EMBEDDED_TERMINAL_PALETTE } from "./terminal-theme";
import { getTerminalRendererOverride } from "./terminal-renderer";
import { attachWebglAtlasRepaint } from "./webgl-atlas-repaint";

/**
 * Exact-pinned xterm.js + addon versions (CLAUDE.md rule 22 / ADR-097 / ADR-098).
 *
 * Verified at test time via `xtermAddons.test.ts` against `client/package.json`.
 * If a future `npm install` lets a caret prefix slip in, the test fails:
 * a stale-`node_modules` runtime drift between `@xterm/headless` (server)
 * and `@xterm/xterm` (client) breaks the snapshot version-gate (ADR-097 →
 * server emits v2 snapshots that the loader rejects → blank terminal with
 * live shell).
 *
 * DO NOT add caret ranges. DO NOT add `windowsMode` (xterm 6.x removed it).
 */
export const XTERM_PIN = {
  "@xterm/xterm": "6.0.0",
  "@xterm/addon-fit": "0.11.0",
  "@xterm/addon-web-links": "0.12.0",
  "@xterm/addon-webgl": "0.19.0",
} as const;

/**
 * Return shape of `createEmbeddedXterm`.
 *   - `term`: the open()-ed Terminal.
 *   - `fit`: the FitAddon, kept by the caller so refit can be triggered on
 *     ResizeObserver + tab activation (useTerminalResize).
 *   - `dispose`: a bound disposer that runs the post-dispose dimensions-stub
 *     guard from the source (ADR-084) BEFORE calling `term.dispose()`.
 *     Returning a bound dispose (rather than a separate `disposeXterm(term)`
 *     helper) resolves the plan-review openai #12 LOW ambiguity.
 */
export interface EmbeddedXtermHandle {
  term: Terminal;
  fit: FitAddon;
  dispose: () => void;
}

/**
 * Helper — resolve a CSS variable from the document body, falling back to
 * the static palette literal. Mirrors the source's inline `cssVar` lambda
 * so the brand-var-aware tokens (--color-error, --color-success, …) still
 * thread through.
 */
function cssVar(name: string, fallback: string): string {
  if (typeof document === "undefined") return fallback;
  const v = getComputedStyle(document.body).getPropertyValue(name).trim();
  return v.length > 0 ? v : fallback;
}

/**
 * Build the Terminal constructor options. Exported separately from
 * `createEmbeddedXterm` so a test can capture the options object without
 * needing a working DOM container — the existing `EmbeddedTerminal.test.tsx`
 * "terminal options — VS Code parity" block relies on capturing the options
 * via the `vi.mock("@xterm/xterm")` factory.
 */
export function buildEmbeddedXtermOptions(): ITerminalOptions {
  const palette = EMBEDDED_TERMINAL_PALETTE;
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
    theme: {
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
      // Brand semantics still flow through CSS-vars where the slot has a
      // natural correspondence; fallback matches the static palette so
      // test luminance assertions stay deterministic.
      brightRed: cssVar("--color-error", palette.brightRed),
      brightGreen: cssVar("--color-success", palette.brightGreen),
      brightYellow: cssVar("--color-warning", palette.brightYellow),
      brightBlue: cssVar("--color-info", palette.brightBlue),
      brightMagenta: cssVar("--color-purple", palette.brightMagenta),
      brightCyan: palette.brightCyan,
      brightWhite: palette.brightWhite,
    },
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

/**
 * The "ADR-084 dimensions-stub guard" — pre-emptively stub the renderer's
 * `dimensions` getter to return safe zero shapes BEFORE invoking
 * `term.dispose()`. xterm's internal `Viewport.syncScrollArea` /
 * `Renderer.refresh` queue RAF callbacks that fire AFTER dispose nulled
 * `_renderService`; without this guard they throw
 * `Cannot read properties of undefined (reading 'dimensions')`.
 *
 * Wrapped in try/catch — if a future xterm makes the getter non-
 * configurable, the catch absorbs the TypeError and `term.dispose()` still
 * runs; the only regression surface is a re-introduced async-tail crash
 * that was always racy.
 */
function installDimensionsStubBeforeDispose(term: Terminal): void {
  try {
    type XtermInternalsForStub = {
      _renderService?: { dimensions?: unknown };
    };
    const core = (term as unknown as { _core?: XtermInternalsForStub })._core;
    const rs = core?._renderService;
    if (rs) {
      const safeDims = {
        css: {
          cell: { width: 0, height: 0 },
          canvas: { width: 0, height: 0 },
        },
        device: {
          cell: { width: 0, height: 0 },
          canvas: { width: 0, height: 0 },
        },
      };
      Object.defineProperty(rs, "dimensions", {
        configurable: true,
        get: () => safeDims,
      });
    }
  } catch {
    /* getter may be non-configurable in future xterm; fall through */
  }
}

/**
 * Pure factory — constructs Terminal + addons, opens the canvas, returns the
 * handle. Behaviour MUST match the source EmbeddedTerminal mount-effect
 * verbatim:
 *   1. `new Terminal({...buildEmbeddedXtermOptions()})`
 *   2. `new FitAddon()` + `new WebLinksAddon()` → `term.loadAddon(fit)`,
 *      `term.loadAddon(links)`.
 *   3. `term.loadAddon(new WebglAddon())` BEFORE `term.open` per ADR-099.
 *      Wrapped in try/catch — WebGL-disabled / headless test envs / GPU-
 *      blacklisted hosts fall back to Canvas/DOM cleanly.
 *   4. `term.open(container)`.
 *   5. `fit.fit()` initial pass — the caller's ResizeObserver re-fits when
 *      the container settles to its real dimensions.
 *
 * The returned `dispose()` closure:
 *   1. Installs the ADR-084 dimensions-stub.
 *   2. Calls `term.dispose()` — failures propagate per
 *      external-review HIGH #2 (do NOT swallow real dispose errors).
 */
export function createEmbeddedXterm(
  container: HTMLElement,
): EmbeddedXtermHandle {
  const term = new Terminal(buildEmbeddedXtermOptions());

  const fit = new FitAddon();
  const links = new WebLinksAddon();
  term.loadAddon(fit);
  term.loadAddon(links);

  // Diagnostic renderer override (iterate-2026-06-23, see terminal-renderer.ts):
  // skip the WebGL addon entirely when the user opts into the DOM renderer, to
  // A/B whether WebGL is the root cause of the "smear" class. Default is unchanged
  // ("webgl"). Logged so the active renderer is visible in the browser console.
  const renderer = getTerminalRendererOverride();
  // eslint-disable-next-line no-console
  console.info(`[EmbeddedTerminal] renderer=${renderer}`);

  if (renderer === "webgl") {
    // ADR-099 — WebGL loaded BEFORE term.open(container) so the DOM renderer
    // never initialises. Wrapped in try/catch: jsdom + WebGL-disabled +
    // GPU-blacklisted hosts fall back to Canvas/DOM (the production tradeoff
    // documented in ADR-099: alt-screen rendering is worse than WebGL but
    // not unusable).
    try {
      const webgl = new WebglAddon();
      // GPU-context-loss recovery (canonical xtermjs/xterm.js demo pattern).
      // Chromium/Edge drop the WebGL context for backgrounded/minimised windows
      // and on GPU-process restarts; without a handler the canvas freezes on a
      // STALE frame — the "terminal smear on window-refocus" bug. Disposing the
      // addon on loss makes xterm fall back to the DOM renderer (which always
      // repaints), and the visibility/focus refit in useTerminalResize then
      // re-fits cleanly. Registered before loadAddon so no loss event is missed.
      webgl.onContextLoss(() => {
        try {
          webgl.dispose();
        } catch {
          /* already disposed — best-effort */
        }
      });
      // Glyph-atlas-change full repaint (root-cause fix for the "wrong letter"
      // corruption) — see webgl-atlas-repaint.ts. Registered before loadAddon so
      // no early atlas-change event is missed, mirroring onContextLoss above.
      attachWebglAtlasRepaint(webgl, term);
      term.loadAddon(webgl);
    } catch (err) {
      // eslint-disable-next-line no-console
      console.warn(
        "[EmbeddedTerminal] WebGL renderer unavailable — falling back to Canvas/DOM:",
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  // renderer === "dom": load no GPU addon — xterm uses its built-in DOM
  // renderer, which fully reflows every frame (no partial-dirty GL buffer to
  // go stale). This is the experiment arm.

  term.open(container);

  // Initial fit. Render-readiness is gated downstream (see safeFit in
  // useTerminalResize) — if cell dims report zero the caller's resize
  // observer will land a real fit when the container settles.
  try {
    fit.fit();
  } catch {
    /* renderer not yet ready — observer will catch up */
  }

  const dispose = (): void => {
    installDimensionsStubBeforeDispose(term);
    // Per external code-review openai HIGH #2 (Iterate 2026-05-15 v0.9.2):
    // do NOT swallow term.dispose() failures. The dimensions-stub above
    // prevents the known xterm-internal async-tail throw; any separate
    // dispose failure is a real correctness regression we WANT to
    // surface, not mask.
    term.dispose();
  };

  return { term, fit, dispose };
}
