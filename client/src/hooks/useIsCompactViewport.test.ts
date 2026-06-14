import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, afterEach } from 'vitest';
import { useIsCompactViewport, COMPACT_MEDIA_QUERY } from './useIsCompactViewport';

type Listener = (e: MediaQueryListEvent) => void;

/**
 * Controllable matchMedia mock: captures the `change` listener so a test can
 * fire it and assert the hook re-renders. Mirrors the project convention in
 * SidebarNav.test.tsx but adds reactive firing.
 */
function mockMatchMedia(initialMatches: boolean) {
  let listener: Listener | null = null;
  const mql = {
    matches: initialMatches,
    media: COMPACT_MEDIA_QUERY,
    onchange: null,
    addEventListener: vi.fn((_evt: string, l: Listener) => {
      listener = l;
    }),
    removeEventListener: vi.fn(() => {
      listener = null;
    }),
    addListener: vi.fn(),
    removeListener: vi.fn(),
    dispatchEvent: vi.fn(),
  };
  window.matchMedia = vi.fn().mockReturnValue(mql) as unknown as typeof window.matchMedia;
  return {
    mql,
    fire(matches: boolean) {
      mql.matches = matches;
      listener?.({ matches } as MediaQueryListEvent);
    },
  };
}

describe('useIsCompactViewport', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('queries the 1023px max-width breakpoint (below Tailwind lg)', () => {
    mockMatchMedia(false);
    renderHook(() => useIsCompactViewport());
    expect(window.matchMedia).toHaveBeenCalledWith('(max-width: 1023px)');
  });

  it('returns true when the compact query matches at mount (tablet/phone)', () => {
    mockMatchMedia(true);
    const { result } = renderHook(() => useIsCompactViewport());
    expect(result.current).toBe(true);
  });

  it('returns false on a desktop viewport (>=1024px)', () => {
    mockMatchMedia(false);
    const { result } = renderHook(() => useIsCompactViewport());
    expect(result.current).toBe(false);
  });

  it('reacts to a media-query change (desktop -> tablet -> desktop)', () => {
    const h = mockMatchMedia(false);
    const { result } = renderHook(() => useIsCompactViewport());
    expect(result.current).toBe(false);
    act(() => h.fire(true));
    expect(result.current).toBe(true);
    act(() => h.fire(false));
    expect(result.current).toBe(false);
  });

  it('subscribes via addEventListener and cleans up on unmount', () => {
    const h = mockMatchMedia(false);
    const { unmount } = renderHook(() => useIsCompactViewport());
    expect(h.mql.addEventListener).toHaveBeenCalledWith('change', expect.any(Function));
    unmount();
    expect(h.mql.removeEventListener).toHaveBeenCalledWith('change', expect.any(Function));
  });

  it('falls back to false (desktop) when matchMedia is unavailable (SSR-safe)', () => {
    const original = window.matchMedia;
    // @ts-expect-error — simulate an environment without matchMedia
    delete window.matchMedia;
    const { result } = renderHook(() => useIsCompactViewport());
    expect(result.current).toBe(false);
    window.matchMedia = original;
  });
});
