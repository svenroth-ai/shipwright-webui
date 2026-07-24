/*
 * terminal-renderer — which renderer the embedded xterm uses.
 *
 * DEFAULT: `dom`. GPU acceleration (WebGL) is OPT-IN.
 *
 * WHY (iterate-2026-07-24-terminal-scroll-atlas-smear, supersedes the
 * iterate-2026-06-23 diagnostic A/B this module started as):
 *
 * The WebGL renderer keeps a GPU-side glyph TEXTURE ATLAS. When that atlas
 * repacks, is evicted, or is cleared while cached cells still hold coordinates
 * into the old layout, cells render a clean letter-for-letter SWAP — the
 * "smear" the user has reported eight times. `term.refresh()` cannot heal it:
 * it routes through `WebglRenderer._updateModel`, which SKIPS cells whose
 * code/fg/bg/ext match the cached model, so a wrong glyph is invisible to it.
 *
 * Seven trigger-based fixes shipped before this one (convertEol, refocus #146,
 * reflow #147, settle #164, activation #167, #175, atlas-clear #206, refocus
 * atlas-heal #215). Each closed one trigger; each next user report found the
 * next. And the heal itself is not even reliable: `TextureAtlas.clearTexture()`
 * (addon-webgl 0.19.0, TextureAtlas.ts:138-141) early-returns based on
 * `_pages[0].currentRow` ALONE, so in the multi-page atlas state that heavy
 * scrolling produces, pages 1..N are never cleared and never get the `version++`
 * that `GlyphRenderer.render` (:361) needs before it re-uploads the texture.
 * Upstream xterm.js documents `clearTextureAtlas` as a WORKAROUND for a
 * Chromium/NVIDIA texture-corruption bug — the atlas is unreliable by upstream's
 * own admission.
 *
 * The DOM renderer has NO texture atlas, so the whole class is structurally
 * impossible rather than incrementally patched. This mirrors VS Code, which
 * runs the same xterm.js and exposes `terminal.integrated.gpuAcceleration`
 * (auto|on|off|canvas) plus a permanent DOM fallback rather than enumerating
 * triggers. Turning GPU acceleration off is also the widely-reported community
 * fix for "Claude Code garbles the VS Code terminal".
 *
 * Tradeoff, stated honestly: the DOM renderer costs more CPU on very fast
 * output. For a Claude Code TUI in a local tool that is not the binding
 * constraint; correctness is. Users who want the GPU path back have the
 * Settings checkbox (or the query param, for a one-off).
 *
 * ZERO React imports — pure resolver + a thin window/localStorage reader,
 * unit-tested in isolation (terminal-renderer.test.ts).
 */

export type TerminalRenderer = "webgl" | "dom";

/**
 * localStorage key the override reads. Set to "webgl" to enable GPU
 * acceleration. Key name predates the default flip and is DELIBERATELY
 * unchanged: a user who already pinned a value keeps it across the flip.
 */
export const RENDERER_STORAGE_KEY = "shipwright:terminal-renderer";

/** The renderer used when nothing is configured (see file header). */
export const DEFAULT_TERMINAL_RENDERER: TerminalRenderer = "dom";

/**
 * Pure resolver. Default `dom`; returns `webgl` only when the URL query
 * `terminalRenderer=webgl` OR the stored value is `webgl` (case-insensitive).
 * The query wins over storage so a one-off `?terminalRenderer=dom` can force
 * the default back even with `webgl` persisted. Any other / malformed value →
 * `dom` (fail toward the renderer that cannot corrupt).
 */
export function resolveTerminalRenderer(opts: {
  search?: string | null;
  storageValue?: string | null;
}): TerminalRenderer {
  let fromQuery: string | null = null;
  if (opts.search) {
    try {
      const v = new URLSearchParams(opts.search).get("terminalRenderer");
      fromQuery = v ? v.trim().toLowerCase() : null;
    } catch {
      fromQuery = null;
    }
  }
  const stored = opts.storageValue ? opts.storageValue.trim().toLowerCase() : null;
  const pick = fromQuery ?? stored;
  return pick === "webgl" ? "webgl" : DEFAULT_TERMINAL_RENDERER;
}

/**
 * Impure reader — pulls the query string + stored value from `window` and
 * delegates to {@link resolveTerminalRenderer}. SSR / test-safe: returns the
 * `dom` default when `window` is absent, and swallows a `localStorage` throw
 * (private-mode / blocked storage).
 */
export function getTerminalRendererOverride(): TerminalRenderer {
  if (typeof window === "undefined") return DEFAULT_TERMINAL_RENDERER;
  let storageValue: string | null = null;
  try {
    storageValue = window.localStorage?.getItem(RENDERER_STORAGE_KEY) ?? null;
  } catch {
    storageValue = null;
  }
  return resolveTerminalRenderer({
    search: window.location?.search ?? null,
    storageValue,
  });
}

/**
 * The STORED preference — what the Settings checkbox shows and writes.
 *
 * Deliberately ignores the `?terminalRenderer=` query param, which
 * {@link getTerminalRendererOverride} still honours as a one-off override.
 * Binding the checkbox to the EFFECTIVE renderer was a real defect (external
 * code review, medium): with `?terminalRenderer=webgl` in the URL the box
 * rendered checked with nothing stored, and un-checking it flipped the box to
 * unchecked while the query kept WebGL alive on the next mount — the control
 * actively lying about the thing it controls. A settings control must reflect
 * the setting; the override is surfaced separately (see
 * {@link isRendererOverriddenByQuery}).
 */
export function isGpuAccelerationEnabled(): boolean {
  if (typeof window === "undefined") return false;
  try {
    const raw = window.localStorage?.getItem(RENDERER_STORAGE_KEY);
    return (raw ? raw.trim().toLowerCase() : null) === "webgl";
  } catch {
    return false;
  }
}

/**
 * True when a `?terminalRenderer=` query param is present AND disagrees with
 * the stored preference — i.e. the checkbox is temporarily not in charge.
 * Settings uses this to say so instead of silently misleading the user.
 */
export function isRendererOverriddenByQuery(): boolean {
  if (typeof window === "undefined") return false;
  const search = window.location?.search ?? null;
  if (!search) return false;
  let fromQuery: string | null = null;
  try {
    const v = new URLSearchParams(search).get("terminalRenderer");
    fromQuery = v ? v.trim().toLowerCase() : null;
  } catch {
    return false;
  }
  if (fromQuery !== "webgl" && fromQuery !== "dom") return false;
  return fromQuery !== (isGpuAccelerationEnabled() ? "webgl" : "dom");
}

/**
 * Persist the GPU-acceleration preference (Settings checkbox). Writes the
 * explicit renderer name rather than removing the key, so the stored value
 * stays readable/greppable and survives a future default change.
 *
 * Non-fatal when storage is unavailable (private mode / blocked storage) — the
 * checkbox then simply does not persist, which is better than throwing out of
 * a settings click.
 *
 * NOTE: takes effect on the NEXT terminal mount. Swapping renderers requires
 * rebuilding the xterm instance (the addon is chosen at construction), so the
 * Settings copy says so rather than silently appearing to do nothing.
 */
export function setGpuAccelerationEnabled(enabled: boolean): void {
  try {
    window.localStorage?.setItem(
      RENDERER_STORAGE_KEY,
      enabled ? "webgl" : "dom",
    );
  } catch {
    /* private mode / storage disabled — non-fatal */
  }
}
