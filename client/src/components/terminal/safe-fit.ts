/*
 * safe-fit — hardened `FitAddon.fit()` wrapper (ADR-084).
 *
 * Extracted from `useTerminalResize.ts` (iterate-2026-06-22, to keep that hook
 * under the 300-LOC guideline). Pure, DOM-free, independently unit-tested via
 * the resize specs; consumed by `useTerminalResize` and `useTerminalShellEffects`.
 */

import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

/**
 * Defence against two xterm hazards (ADR-084):
 *
 *   (a) post-dispose stragglers: an async tail of `fit.fit()` running after
 *       `term.dispose()` would access `term._core._renderService.dimensions`
 *       (nulled by dispose) and throw `Cannot read properties of undefined
 *       (reading 'dimensions')`. That async tail escapes the existing
 *       try/catch frames around the synchronous `fit.fit()` call.
 *
 *   (b) pre-renderer-ready: between `new Terminal()` and the first
 *       fully-rendered frame, `_renderService` may exist but `dimensions`
 *       reports zero `css.cell.width / height`. FitAddon's
 *       `proposeDimensions()` would then compute `Math.floor(width/0) → NaN`.
 *
 * Brittleness guard (ADR-084 external review gemini #2): if `_core` /
 * `_renderService` is missing ENTIRELY (e.g. a future xterm refactor
 * renames private internals), DON'T silently short-circuit — fall
 * through to `fit.fit()` inside the try/catch so the path keeps working.
 * Only "renderer present but dimensions invalid" short-circuits.
 *
 * `disposed` is a plain boolean — caller passes `disposedRef.current` so
 * React's render isolation doesn't capture a stale `false`.
 */
type XtermCorePeek = {
  _renderService?: {
    dimensions?: {
      css?: { cell?: { width?: number; height?: number } };
    };
  };
};
export function safeFit(
  fit: FitAddon | null,
  term: Terminal | null,
  disposed: boolean,
): boolean {
  if (disposed || !fit || !term) return false;
  try {
    const core = (term as unknown as { _core?: XtermCorePeek })._core;
    if (core?._renderService) {
      const dims = core._renderService.dimensions;
      const cellW = dims?.css?.cell?.width ?? 0;
      const cellH = dims?.css?.cell?.height ?? 0;
      if (!dims || cellW === 0 || cellH === 0) return false;
    }
    fit.fit();
    return true;
  } catch {
    // Catches the async-tail TypeError from accessing dimensions on a
    // disposed renderer.
    return false;
  }
}
