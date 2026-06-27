/*
 * webgl-atlas-repaint — full-viewport repaint whenever the WebGL glyph atlas
 * mutates. Root-cause fix for the "wrong letter" corruption (user report
 * 2026-06-27; iterate-2026-06-27-webgl-atlas-glyph-corruption).
 *
 * The WebGL renderer caches rasterised glyphs in a GPU texture-atlas (one or more
 * page canvases) keyed by glyph + fg + bg + style. The render model records, per
 * cell, which page + coordinate to sample. When the atlas mutates mid-stream — a
 * new page is added on overflow (`onAddTextureAtlasCanvas`, the long-colourful-
 * session case), or the atlas is cleared / repacked / regenerated on a font-size,
 * theme, DPR or resize change (`onChangeTextureAtlas`) — cells drawn BEFORE the
 * mutation are NOT re-marked dirty, so they keep sampling their old page/coord.
 * After a repack that coordinate can now hold a DIFFERENT glyph → a clean
 * letter-for-letter swap that, until now, only a manual resize healed (resize
 * marks every cell dirty and full-repaints).
 *
 * `term.refresh(0, rows-1)` re-resolves EVERY visible cell against the CURRENT
 * atlas; the catch is purely one of TIMING — the existing repaint triggers
 * (resize / activation / scroll / settle) never fire at atlas-mutation time.
 * Subscribing to the atlas-mutation events and repainting exactly when the atlas
 * changes closes the gap — the same end state a resize reaches, but automatic.
 *
 * Distinct from the hide/show "smear" (a stale GL FRAMEBUFFER, healed by the
 * visibility/focus refresh in useTerminalResize). Sibling of the other
 * single-concern repaint helpers. ZERO React imports — unit-tested through the
 * factory in xtermAddons.atlas.test.ts; real-browser proof in e2e flow spec 94.
 */

import type { Terminal } from "@xterm/xterm";
import type { WebglAddon } from "@xterm/addon-webgl";

/**
 * Window key the real-browser e2e (flow spec 94) reads to confirm the LIVE WebGL
 * addon actually emitted an atlas-mutation event and this handler fired — the
 * only side effect observable from outside the renderer on a real GPU.
 */
export const ATLAS_REPAINT_WINDOW_KEY = "__embeddedTerminalAtlasRepaints";

/** The subset of the addon surface this helper consumes. */
type AtlasMutationEvents = Pick<
  WebglAddon,
  "onChangeTextureAtlas" | "onAddTextureAtlasCanvas" | "onRemoveTextureAtlasCanvas"
>;

/**
 * Repaint the whole viewport on EVERY texture-atlas mutation (page add on
 * overflow, clear/repack/regenerate, page remove). A full refresh is idempotent
 * and cheap, and atlas mutations are rare after warm-up, so routing all three
 * events through one handler is safe and covers whichever event a given GPU
 * emits. Returns a composite IDisposable; the subscriptions are also torn down
 * automatically when the addon disposes (via `term.dispose()` / context-loss).
 */
export function attachWebglAtlasRepaint(
  webgl: AtlasMutationEvents,
  term: Pick<Terminal, "refresh" | "rows">,
): { dispose: () => void } {
  const repaint = (): void => {
    try {
      term.refresh(0, term.rows - 1);
      if (typeof window !== "undefined") {
        const w = window as unknown as Record<string, number | undefined>;
        w[ATLAS_REPAINT_WINDOW_KEY] = (w[ATLAS_REPAINT_WINDOW_KEY] ?? 0) + 1;
      }
    } catch (err) {
      // Expected on a mid-dispose terminal; a later mutation reschedules. Logged
      // at debug so a PERSISTENT failure (corruption left masked) stays visible.
      // eslint-disable-next-line no-console
      console.debug("[atlas-repaint] refresh skipped (term unavailable)", err);
    }
  };
  const subs = [
    webgl.onChangeTextureAtlas(repaint),
    webgl.onAddTextureAtlasCanvas(repaint),
    webgl.onRemoveTextureAtlasCanvas(repaint),
  ];
  return {
    dispose: () => {
      for (const s of subs) {
        try {
          s.dispose();
        } catch {
          /* best-effort — addon dispose also tears these down */
        }
      }
    },
  };
}
