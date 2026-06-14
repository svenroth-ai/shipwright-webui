import { useEffect, useState } from 'react';

/**
 * Responsive breakpoint hooks — the single JS source of truth for the
 * "compact" and "phone" layout bands.
 *
 * - `(max-width: 1023px)` (COMPACT) is everything below Tailwind's `lg`
 *   breakpoint (1024px): tablet (768–1023px) AND phone (<768px) both read as
 *   compact (iterate-2026-06-14-tablet-responsive-view). The ≥1024px desktop
 *   layout is unchanged. Consumers: SidebarNav rail threshold,
 *   TaskDetailThreePane compact tab layout.
 * - `(max-width: 767px)` (PHONE) is the narrower phone band added in
 *   iterate-2026-06-14-phone-responsive-view. Consumers: MainLayout sidebar
 *   overlay drawer (the 60px rail + 200px expand both eat a 375px screen).
 *
 * The phone query is added ALONGSIDE the compact query (not a fork of the
 * compact threshold — plan-review M2 from iterate-1) so the two width sources
 * cannot disagree at the boundary. Both hooks share the SSR-safe / reactive
 * `useMediaQuery` body verbatim, including the effect-time re-sync that catches
 * a viewport change between the initial render and the effect committing.
 */
export const COMPACT_MEDIA_QUERY = '(max-width: 1023px)';
export const PHONE_MEDIA_QUERY = '(max-width: 767px)';
/**
 * `(pointer: coarse)` — the primary input is a touch/imprecise pointer, i.e. a
 * device with no precise hardware keyboard most of the time. Gates the embedded
 * terminal's on-screen key bar so it appears "everywhere" a touch device is
 * used (phone OR touch tablet, any width) and never on a fine-pointer desktop.
 */
export const COARSE_POINTER_QUERY = '(pointer: coarse)';

function hasMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

/**
 * Subscribe to a media query. SSR / non-browser test environments without
 * `matchMedia` resolve to `false` (assume desktop).
 */
function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState<boolean>(() =>
    hasMatchMedia() ? window.matchMedia(query).matches : false,
  );

  useEffect(() => {
    if (!hasMatchMedia()) return;
    const mql = window.matchMedia(query);
    const handler = (e: MediaQueryListEvent) => setMatches(e.matches);
    // Re-sync: the viewport may have changed between the initial render and the
    // effect committing (first-paint flash guard).
    setMatches(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, [query]);

  return matches;
}

/** `true` when the viewport is at most 1023px wide (tablet OR phone). */
export function useIsCompactViewport(): boolean {
  return useMediaQuery(COMPACT_MEDIA_QUERY);
}

/** `true` when the viewport is at most 767px wide (phone). */
export function useIsPhoneViewport(): boolean {
  return useMediaQuery(PHONE_MEDIA_QUERY);
}

/** `true` on a coarse (touch) primary pointer — see COARSE_POINTER_QUERY. */
export function useCoarsePointer(): boolean {
  return useMediaQuery(COARSE_POINTER_QUERY);
}
