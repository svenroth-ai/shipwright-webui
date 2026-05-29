/*
 * useAutoScroll unit coverage — 2026-04-23 iterate-20260423-chat-followups AC-2.
 *
 * Covers the pre-growth at-bottom gate that prevents unwanted viewport
 * jumps when the user expands a ToolCard mid-transcript. The ResizeObserver
 * callback is captured via a mock and invoked manually with controlled
 * scrollHeight / scrollTop / clientHeight values to simulate growth
 * scenarios without a real layout engine.
 */

import { act, renderHook } from "@testing-library/react";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { useAutoScroll } from "./useAutoScroll";
import { createRef } from "react";

type ROCallback = (entries: ResizeObserverEntry[], obs: ResizeObserver) => void;

// Captured callbacks from every ResizeObserver instantiated during the test.
let capturedCallbacks: ROCallback[] = [];
let originalResizeObserver: typeof ResizeObserver | undefined;

class MockResizeObserver {
  constructor(cb: ROCallback) {
    capturedCallbacks.push(cb);
  }
  observe = vi.fn();
  unobserve = vi.fn();
  disconnect = vi.fn();
}

beforeEach(() => {
  capturedCallbacks = [];
  originalResizeObserver = globalThis.ResizeObserver as typeof ResizeObserver | undefined;
  (globalThis as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
    MockResizeObserver as unknown as typeof ResizeObserver;
});

afterEach(() => {
  if (originalResizeObserver) {
    (globalThis as { ResizeObserver: typeof ResizeObserver }).ResizeObserver =
      originalResizeObserver;
  }
  document.body.innerHTML = "";
});

/**
 * jsdom exposes scrollHeight / clientHeight as read-only properties
 * (backed by the computed layout, which jsdom doesn't run). For the
 * test we override them with writable accessors so we can drive the
 * RO callback with controlled growth/shrink scenarios.
 */
function setScrollHeight(el: HTMLElement, value: number) {
  Object.defineProperty(el, "scrollHeight", {
    configurable: true,
    get: () => value,
  });
}

function setClientHeight(el: HTMLElement, value: number) {
  Object.defineProperty(el, "clientHeight", {
    configurable: true,
    get: () => value,
  });
}

function makeContainer({
  scrollHeight = 1000,
  scrollTop = 0,
  clientHeight = 500,
}: {
  scrollHeight?: number;
  scrollTop?: number;
  clientHeight?: number;
} = {}) {
  const outer = document.createElement("div");
  const inner = document.createElement("div");
  outer.appendChild(inner);
  document.body.appendChild(outer);

  setScrollHeight(outer, scrollHeight);
  setClientHeight(outer, clientHeight);
  // scrollTop is writable in jsdom; assign directly.
  outer.scrollTop = scrollTop;

  return outer;
}

describe("useAutoScroll — AC-2 pre-growth at-bottom gate", () => {
  it("does NOT scroll on RO growth when user was mid-transcript (far from prev bottom)", () => {
    // Setup: prev scrollHeight 1000, clientHeight 500, scrollTop 100.
    // distanceFromPrevBottom = 1000 - 100 - 500 = 400 > threshold (64).
    const el = makeContainer({ scrollHeight: 1000, scrollTop: 100, clientHeight: 500 });
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLDivElement | null }).current = el;

    renderHook(() => useAutoScroll(ref, "dep-0"));

    // Simulate tool-card expansion: scrollHeight grows from 1000 → 1300.
    setScrollHeight(el, 1300);

    // Fire the RO callback that was registered on mount.
    act(() => {
      for (const cb of capturedCallbacks) {
        cb([], {} as ResizeObserver);
      }
    });

    // User was mid-transcript; scrollTop should NOT have been forced to scrollHeight.
    expect(el.scrollTop).toBe(100);
  });

  it("DOES scroll on RO growth when user was within threshold of prev bottom", () => {
    // distanceFromPrevBottom = 1000 - 460 - 500 = 40 < 64.
    const el = makeContainer({ scrollHeight: 1000, scrollTop: 460, clientHeight: 500 });
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLDivElement | null }).current = el;

    renderHook(() => useAutoScroll(ref, "dep-0"));

    setScrollHeight(el, 1300);
    act(() => {
      for (const cb of capturedCallbacks) {
        cb([], {} as ResizeObserver);
      }
    });

    // User was near bottom pre-growth; expect a re-pin to the new bottom.
    expect(el.scrollTop).toBe(1300);
  });

  it("does NOT scroll on SHRINK (collapsing a tool card)", () => {
    // scrollHeight 1000 → 700. User was at bottom previously, but we
    // don't want a shrink to snap them anywhere.
    const el = makeContainer({ scrollHeight: 1000, scrollTop: 500, clientHeight: 500 });
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLDivElement | null }).current = el;

    renderHook(() => useAutoScroll(ref, "dep-0"));

    setScrollHeight(el, 700);
    act(() => {
      for (const cb of capturedCallbacks) {
        cb([], {} as ResizeObserver);
      }
    });

    // Scroll position untouched on shrink.
    expect(el.scrollTop).toBe(500);
  });

  it("uses current scrollHeight as baseline after each callback (handles sequential growths)", () => {
    // Two-step growth: user at bottom of 1000, grows to 1300 (scroll happens),
    // then grows to 1500. Second growth should also scroll because the
    // previous-height was updated to 1300 after the first callback.
    const el = makeContainer({ scrollHeight: 1000, scrollTop: 480, clientHeight: 500 });
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLDivElement | null }).current = el;

    renderHook(() => useAutoScroll(ref, "dep-0"));

    // First growth: 1000 → 1300, user at 480 (distance 20 < 64) → scroll.
    setScrollHeight(el, 1300);
    act(() => {
      for (const cb of capturedCallbacks) cb([], {} as ResizeObserver);
    });
    expect(el.scrollTop).toBe(1300);

    // After scroll, scrollTop = 1300. clientHeight 500. prev=1300.
    // distance = 1300 - 1300 - 500 = -500 (negative = past bottom).
    setScrollHeight(el, 1500);
    act(() => {
      for (const cb of capturedCallbacks) cb([], {} as ResizeObserver);
    });
    // User was at/past bottom; expect re-pin to new bottom.
    expect(el.scrollTop).toBe(1500);
  });

  it("rehydrates the prev-height baseline on dep change (transcript-swap hygiene)", () => {
    // Simulate session-swap: same ref, new dep. The RO useEffect
    // re-fires (teardown + re-attach) with a fresh scrollHeight baseline
    // from the new container. Without this the first callback after
    // the swap would compare against a stale prev from the previous
    // session and misclassify growth vs shrink.
    const el = makeContainer({ scrollHeight: 1000, scrollTop: 500, clientHeight: 500 });
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLDivElement | null }).current = el;

    const { rerender } = renderHook(
      ({ d }: { d: string }) => useAutoScroll(ref, d),
      { initialProps: { d: "session-a" } },
    );
    // Drop the old observer by switching dep. The effect re-runs and
    // re-observes against the current scrollHeight.
    setScrollHeight(el, 400);
    rerender({ d: "session-b" });

    // New session's content grows from 400 → 1000. User position in
    // current scrollTop = 500 (stale from previous session). Distance
    // from NEW-baseline (400) bottom = 400 - 500 - 500 = -600 (already
    // past bottom). So growth should re-pin.
    setScrollHeight(el, 1000);
    act(() => {
      for (const cb of capturedCallbacks) cb([], {} as ResizeObserver);
    });
    expect(el.scrollTop).toBe(1000);
  });

  it("does NOT scroll after the user manually scrolls away (userDetached)", () => {
    const el = makeContainer({ scrollHeight: 1000, scrollTop: 480, clientHeight: 500 });
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLDivElement | null }).current = el;

    renderHook(() => useAutoScroll(ref, "dep-0"));

    // User scrolls up (away from bottom). distance = 1000 - 100 - 500 = 400 > 64.
    el.scrollTop = 100;
    el.dispatchEvent(new Event("scroll"));

    // Now content grows — user moved away, should NOT be yanked back.
    setScrollHeight(el, 1300);
    act(() => {
      for (const cb of capturedCallbacks) cb([], {} as ResizeObserver);
    });
    expect(el.scrollTop).toBe(100);
  });
});

// 2026-05-01 — iterate-2026-05-01-system-chips-and-scroll-polish.
//
// User report: "Beim hochscrollen springt alles. es flackert und ich kann
// nicht schön hochscrollen." Root cause: when the user is actively
// scrolling but hasn't yet crossed the userDetached threshold, polling
// ticks at 1 Hz fire programmatic scroll-to-bottom and yank them back.
// Fix: suppress programmatic re-pin for ACTIVE_SCROLL_GUARD_MS after the
// last user-driven scroll event so micro-scrolls at the bottom edge don't
// fight the user.
describe("useAutoScroll — active-scroll suspension guard", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does NOT scroll on RO growth fired within the active-scroll guard window", () => {
    // User is at the bottom (distance 20 < threshold), then scrolls — even
    // though the userDetached flag may not flip (the scroll stayed within
    // threshold), the guard should still suppress the programmatic re-pin.
    const el = makeContainer({ scrollHeight: 1000, scrollTop: 480, clientHeight: 500 });
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLDivElement | null }).current = el;

    renderHook(() => useAutoScroll(ref, "dep-0"));

    // Simulate a small user scroll event — stays "near bottom" so userDetached
    // does not flip, but the guard timestamp is now fresh.
    el.scrollTop = 470;
    el.dispatchEvent(new Event("scroll"));

    // Polling tick arrives almost immediately afterwards — within the guard
    // window — and would normally re-pin the user to scrollHeight=1300.
    setScrollHeight(el, 1300);
    act(() => {
      for (const cb of capturedCallbacks) cb([], {} as ResizeObserver);
    });
    // User position must NOT have been yanked.
    expect(el.scrollTop).toBe(470);
  });

  it("STAYS detached after the guard window once the user scrolled up with intent (AC4 contract change)", () => {
    // 2026-05-27 AC4 — REPLACES the prior "re-pin after the guard window"
    // contract. The 250ms guard treated the symptom; intent-based detach
    // treats the cause. Detach is now STICKY: once the user scrolls UP
    // (480 → 470, a 10px upward delta outside the 8px rubber-band zone),
    // `isAtBottom` stays false even after the guard window elapses — only
    // scrolling back within NEAR_BOTTOM_THRESHOLD_PX re-attaches. We assert
    // on `isAtBottom` (the observable that drives the Jump-to-latest button)
    // rather than scrollTop, to avoid the mount-scroll / RO-guard timing
    // artifacts that conflate this contract with re-pin mechanics.
    const el = makeContainer({ scrollHeight: 1000, scrollTop: 480, clientHeight: 500 });
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLDivElement | null }).current = el;

    const { result } = renderHook(() => useAutoScroll(ref, "dep-0"));

    act(() => {
      el.scrollTop = 470; // upward delta 10px; distance 30 (> 8 rubber-band)
      el.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.isAtBottom).toBe(false);

    act(() => {
      vi.advanceTimersByTime(400);
    });
    // Guard window elapsed — detach is sticky, NOT time-based.
    expect(result.current.isAtBottom).toBe(false);
  });
});

// 2026-05-27 — iterate-2026-05-27-transcript-renderer-scroll AC4.
// Intent-based detach: ANY upward movement outside the rubber-band zone
// detaches immediately, even when still inside the 64px at-bottom band.
// Re-attach stays threshold-based. Rubber-band overshoot at the absolute
// bottom must NOT detach. These assert on the `isAtBottom` observable (the
// detach signal that gates the Jump-to-latest button), which isolates the
// detach DECISION from the mount-scroll / RO-guard re-pin mechanics covered
// by the AC-2 block above.
describe("useAutoScroll — AC4 intent-based detach", () => {
  function mount(scrollTop: number) {
    const el = makeContainer({ scrollHeight: 1000, scrollTop, clientHeight: 500 });
    const ref = createRef<HTMLDivElement>();
    (ref as { current: HTMLDivElement | null }).current = el;
    const { result } = renderHook(() => useAutoScroll(ref, "dep-0"));
    return { el, result };
  }

  it("detaches (isAtBottom=false) on a small upward delta inside the at-bottom band", () => {
    // Start at 480 (distance 20, atBottom). Scroll UP to 460 → distance 40
    // (still atBottom by position, but > 8 rubber-band) → intent detach.
    const { el, result } = mount(480);
    act(() => {
      el.scrollTop = 460;
      el.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.isAtBottom).toBe(false);
  });

  it("does NOT detach on a rubber-band bounce at the absolute bottom", () => {
    // At the absolute bottom (scrollTop 500, distance 0). Elastic overshoot
    // bounces back UP 3px → scrollTop 497, distance 3 (< 8 tolerance). Not
    // intent — must stay attached.
    const { el, result } = mount(500);
    act(() => {
      el.scrollTop = 497;
      el.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.isAtBottom).toBe(true);
  });

  it("does NOT spuriously detach on the first scroll event after mount (lastScrollTop init)", () => {
    // External-review HIGH-3: lastScrollTop seeds from el.scrollTop at attach,
    // not 0. A first scroll event with NO movement must not flip detach.
    const { el, result } = mount(480);
    act(() => {
      el.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.isAtBottom).toBe(true);
  });

  it("re-attaches when the user scrolls back within the threshold", () => {
    const { el, result } = mount(480);
    act(() => {
      el.scrollTop = 200; // far up → detach
      el.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.isAtBottom).toBe(false);
    act(() => {
      el.scrollTop = 480; // back within threshold (distance 20 < 64) → re-attach
      el.dispatchEvent(new Event("scroll"));
    });
    expect(result.current.isAtBottom).toBe(true);
  });
});
