/*
 * terminal-renderer — runtime renderer override for the embedded xterm
 * (iterate-2026-06-23, DIAGNOSTIC).
 *
 * The embedded-terminal "smear" class has survived FIVE trigger-based fixes
 * (convertEol, window-refocus #146, reflow #147, data-driven settle #164,
 * idle-tab-switch #167) — all variants of "find the trigger, call
 * `term.refresh`". It reproduces across active / idle / read-only-replay, which
 * points past the trigger to the WebGL renderer itself: `term.refresh` redraws
 * glyphs but does not reset the GL framebuffer / texture-atlas that goes stale
 * after the canvas is hidden (`display:none`) or re-fed (replay).
 *
 * This override lets a user A/B the renderer on a real GPU WITHOUT a rebuild,
 * to confirm or refute that hypothesis: if the DOM renderer kills the smear in
 * every case, WebGL is proven the root cause and the real fix follows. The
 * default is unchanged (`webgl`) so nothing changes for anyone who does not
 * opt in. Reversible: clear the query param / storage key.
 *
 * ZERO React imports — pure resolver + a thin window/localStorage reader,
 * unit-tested in isolation (terminal-renderer.test.ts).
 */

export type TerminalRenderer = "webgl" | "dom";

/** localStorage key the override reads. Set to "dom" to disable WebGL. */
export const RENDERER_STORAGE_KEY = "shipwright:terminal-renderer";

/**
 * Pure resolver. Default `webgl`; returns `dom` only when the URL query
 * `terminalRenderer=dom` OR the stored value is `dom` (case-insensitive). The
 * query wins over storage so a one-off `?terminalRenderer=webgl` can force the
 * default back even with `dom` persisted. Any other / malformed value → `webgl`.
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
  return pick === "dom" ? "dom" : "webgl";
}

/**
 * Impure reader — pulls the query string + stored value from `window` and
 * delegates to {@link resolveTerminalRenderer}. SSR / test-safe: returns the
 * `webgl` default when `window` is absent, and swallows a `localStorage` throw
 * (private-mode / blocked storage).
 */
export function getTerminalRendererOverride(): TerminalRenderer {
  if (typeof window === "undefined") return "webgl";
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
