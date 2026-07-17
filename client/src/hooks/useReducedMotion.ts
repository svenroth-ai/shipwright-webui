import { useEffect, useState } from "react";

/**
 * useReducedMotion (A20, FR-01.64) — the reduced-motion signal for JS-driven
 * moments (count-up, ring/sparkline draw).
 *
 * Sven runs Windows with animations OFF, so `prefers-reduced-motion: reduce` is
 * the PRIMARY state, not an edge case. The one non-obvious rule lives in the
 * fallback: when `matchMedia` is unavailable (SSR / jsdom / an old embedder) the
 * hook returns `true` — it FAILS TOWARD NO MOTION, never toward hidden content.
 * A moment reading `true` renders its final value/path immediately.
 */

export const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function hasMatchMedia(): boolean {
  return typeof window !== "undefined" && typeof window.matchMedia === "function";
}

export function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState<boolean>(() =>
    hasMatchMedia() ? window.matchMedia(REDUCED_MOTION_QUERY).matches : true,
  );

  useEffect(() => {
    if (!hasMatchMedia()) return;
    const mql = window.matchMedia(REDUCED_MOTION_QUERY);
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    // Re-sync: the preference may have changed between the initial render and
    // the effect committing.
    setReduced(mql.matches);
    mql.addEventListener("change", handler);
    return () => mql.removeEventListener("change", handler);
  }, []);

  return reduced;
}
