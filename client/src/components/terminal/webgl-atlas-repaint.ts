/*
 * webgl-atlas-repaint — heal the WebGL glyph-atlas "wrong letter" corruption by
 * CLEARING the texture atlas when it repacks (user reports 2026-06-27 +
 * 2026-07-07; iterate-2026-07-07-terminal-glyph-atlas-clear, superseding the
 * #175 `term.refresh` approach).
 *
 * ROOT CAUSE — why the earlier `term.refresh(0, rows-1)` did not fully fix it.
 * `refresh` routes through RenderService.refreshRows → WebglRenderer._updateModel,
 * which SKIPS cells whose code/fg/bg/ext match the cached model. So healing a
 * "wrong letter" needs the render MODEL cleared, not just the rows redrawn.
 *
 * The LOAD-BEARING corruption path (source-verified in @xterm/addon-webgl 0.19.0)
 * is a WHOLE-ATLAS SWAP on a terminal-option change: WebglRenderer._handleOptionsChanged
 * → _refreshCharAtlas builds a fresh atlas and fires onChangeTextureAtlas
 * (WebglRenderer.ts:243-245,284) — but, UNLIKE handleResize / DPR-change, it does
 * NOT clear the model (contrast the _clearModel calls at :161 / :203). Existing
 * cells keep coordinates into the OLD atlas layout, which the new atlas packs
 * differently → a clean letter-for-letter swap that `refresh` cannot undo (the
 * cells "look unchanged", so _updateModel skips them). This fires on ANY option
 * change — notably the live theme re-resolve (`term.options.theme = <fresh object>`,
 * FR-01.44 #201) on focus / Claude-theme fetch / OS-scheme, which is why it recurs
 * in long sessions with no manual resize.
 *
 * A manual resize heals because handleResize DOES clear the model + glyph renderer
 * (WebglRenderer.handleResize → _clearModel(true)). The atlas REPACK path
 * (TextureAtlas._mergePages → onRemoveTextureAtlasCanvas) already self-heals on the
 * next frame via TextureAtlas._requestClearModel (:195), so `refresh` handled that
 * one — we still clear on it, defensively, so any repack that reassigns a live
 * coordinate can never strand a cell.
 *
 * FIX — call the PUBLIC equivalent of the resize heal: `Terminal.clearTextureAtlas()`
 * (xterm.d.ts → RenderService.clearTextureAtlas → WebglRenderer clears the atlas +
 * render model + glyph renderer via _clearModel(true), then a full refresh —
 * WebglRenderer.ts:307-310). Two subtleties, each of which — if gotten wrong —
 * makes the "fix" worse than the bug:
 *
 *   1. Subscribe to onChangeTextureAtlas (the LOAD-BEARING path above — DO NOT drop
 *      it) + onRemoveTextureAtlasCanvas (defensive), but NOT onAddTextureAtlasCanvas.
 *      A plain page-ADD appends NEW glyphs to fresh coordinates; it never moves an
 *      existing cell's coordinate, so it cannot cause the letter-swap. And clearing
 *      on add is a FEEDBACK LOOP: clear → re-raster the screen → a page overflows →
 *      onAdd → clear → … forever.
 *
 *   2. DEFER the clear (a single coalesced microtask), never call it synchronously
 *      in the event handler. onRemoveTextureAtlasCanvas fires MID-_mergePages;
 *      calling clearTextureAtlas re-entrantly would tear down the atlas the merge
 *      is still mutating. A microtask runs after the whole synchronous atlas
 *      operation unwinds, and the `pending` guard collapses an event burst into
 *      one clear (one global clear heals every corruption up to that point).
 *
 * Distinct from the hide/show framebuffer "smear" (a stale GL FRAMEBUFFER, healed
 * by the visibility/focus refresh in useTerminalResize). ZERO React imports —
 * unit-tested through the factory in xtermAddons.atlas.test.ts; real-browser
 * proof in e2e flow spec 94.
 */

import type { Terminal } from "@xterm/xterm";
import type { WebglAddon } from "@xterm/addon-webgl";

/**
 * Window key the real-browser e2e (flow spec 94) reads to confirm the LIVE WebGL
 * addon actually emitted an atlas-mutation event and this handler healed — the
 * only side effect observable from outside the renderer on a real GPU.
 */
export const ATLAS_REPAINT_WINDOW_KEY = "__embeddedTerminalAtlasRepaints";

/**
 * The atlas-mutation events that reassign EXISTING glyph coordinates (and so can
 * corrupt an already-drawn cell). Deliberately excludes onAddTextureAtlasCanvas
 * — see subtlety (1) in the file header.
 */
type AtlasHealEvents = Pick<
  WebglAddon,
  "onChangeTextureAtlas" | "onRemoveTextureAtlasCanvas"
>;

/** Defer a callback to run once the current synchronous stack has unwound. */
export type HealScheduler = (cb: () => void) => void;

/**
 * On every atlas repack (change / page-remove), schedule a single deferred,
 * coalesced `term.clearTextureAtlas()` — the public equivalent of the resize
 * heal. Returns a composite IDisposable; `dispose()` unsubscribes AND cancels any
 * still-pending clear so a heal can never land on a torn-down terminal. The
 * subscriptions are also torn down automatically when the addon disposes (via
 * `term.dispose()` / context-loss), so disposing is idempotent.
 *
 * @param schedule injectable for deterministic tests; defaults to queueMicrotask.
 */
export function attachWebglAtlasRepaint(
  webgl: AtlasHealEvents,
  term: Pick<Terminal, "clearTextureAtlas">,
  schedule: HealScheduler = queueMicrotask,
): { dispose: () => void } {
  let disposed = false;
  let pending = false;

  const flush = (): void => {
    pending = false;
    if (disposed) return;
    try {
      term.clearTextureAtlas();
      if (typeof window !== "undefined") {
        const w = window as unknown as Record<string, number | undefined>;
        w[ATLAS_REPAINT_WINDOW_KEY] = (w[ATLAS_REPAINT_WINDOW_KEY] ?? 0) + 1;
      }
    } catch (err) {
      // Expected on a mid-dispose terminal; a later mutation reschedules. Logged
      // at debug so a PERSISTENT failure (corruption left masked) stays visible.
      // eslint-disable-next-line no-console
      console.debug("[atlas-heal] clearTextureAtlas skipped (term unavailable)", err);
    }
  };

  const heal = (): void => {
    if (pending || disposed) return;
    pending = true;
    schedule(flush);
  };

  const subs = [
    webgl.onChangeTextureAtlas(heal),
    webgl.onRemoveTextureAtlasCanvas(heal),
  ];

  return {
    dispose: () => {
      disposed = true;
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
