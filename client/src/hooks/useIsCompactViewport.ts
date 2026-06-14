import { useEffect, useState } from 'react';

/**
 * Compact-viewport breakpoint — the single source of truth for the "compact"
 * layout band (iterate-2026-06-14-tablet-responsive-view).
 *
 * `(max-width: 1023px)` is everything below Tailwind's `lg` breakpoint (1024px):
 * tablet (768–1023px) and phone (<768px) both read as compact; the ≥1024px
 * desktop layout is unchanged. Every JS consumer (SidebarNav rail threshold,
 * TaskDetailThreePane compact tab layout) MUST gate on this one query so the
 * different width sources cannot disagree at the boundary (plan-review M2) —
 * notably NOT the container `measuredWidth` in TaskDetailThreePane, which is
 * sidebar-rail-dependent and would falsely flip to compact at a 1024px viewport.
 */
export const COMPACT_MEDIA_QUERY = '(max-width: 1023px)';

function hasMatchMedia(): boolean {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function';
}

/**
 * Returns `true` when the viewport is at most 1023px wide. SSR / non-browser
 * test environments without `matchMedia` resolve to `false` (assume desktop).
 */
export function useIsCompactViewport(): boolean {
  const [compact, setCompact] = useState<boolean>(() =>
    hasMatchMedia() ? window.matchMedia(COMPACT_MEDIA_QUERY).matches : false,
  );

  useEffect(() => {
    if (!hasMatchMedia()) return;
    const mql = window.matchMedia(COMPACT_MEDIA_QUERY);
    const handler = (e: MediaQueryListEvent) => setCompact(e.matches);
    // Re-sync: the viewport may have changed between the initial render and the
    // effect committing.
    setCompact(mql.matches);
    mql.addEventListener('change', handler);
    return () => mql.removeEventListener('change', handler);
  }, []);

  return compact;
}
