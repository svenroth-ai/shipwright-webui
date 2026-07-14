/*
 * useTerminalResize — WebGL glyph-atlas heal on a re-show
 * (iterate-2026-07-14-terminal-atlas-heal-on-refocus, FR-01.28).
 *
 * User report 2026-07-14: after the window/tab is left and re-entered, isolated
 * cells render the WRONG LETTER — the #206 glyph-atlas corruption class, on a
 * trigger #206 does not cover. The re-show path healed ONLY with
 * `term.refresh(0, rows-1)`, which routes to WebglRenderer._updateModel and
 * SKIPS cells that "look unchanged" — so a texture the browser evicted or
 * repacked while the window was backgrounded is redrawn from its STALE atlas
 * coordinate. Only `term.clearTextureAtlas()` (atlas texture + render model +
 * full redraw) heals that, and nothing on the re-show path called it.
 *
 * These tests pin the WIRING (the root cause), not the pixels. The visual kill
 * on a real GPU is `requires-physical-device` (SwiftShader evicts no textures).
 *
 * TWO INVARIANTS ARE LOAD-BEARING, both learned the hard way:
 *
 * 1. TIMING: the heal fires from the DEFERRED trailing passes — one per pass —
 *    never synchronously on the event. `clearTextureAtlas()` only *requests* a
 *    redraw, served on a later frame; on the event the just-un-hidden
 *    (`display:none` → block) canvas has not composited at its real size yet.
 *    Riding EVERY pass (not just the last, as the first draft had it) is the
 *    doubt-review correction: a single fixed deadline is the fragility #167
 *    already learned to avoid, and an early clear is redundant rather than
 *    harmful — it invalidates every atlas texture, so model and atlas stay
 *    consistent (verified in the installed @xterm/addon-webgl).
 *
 * 2. VISIBILITY (code-review LOW-3): the heal is gated on `active`, read at FIRE
 *    time. The terminal stays MOUNTED behind the inactive tab (`forceMount` +
 *    `display:none`), so a window refocus while the user is on Transcript would
 *    re-raster the atlas into a canvas that never composites. Nothing is lost:
 *    switching TO the Terminal tab re-schedules and heals then.
 */

import { act } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  installResizeHarness,
  setHidden,
  type ResizeHarness,
  type SetupResult,
} from "./useTerminalResize.test-harness";
import { ACTIVATION_REPAINT_DELAYS_MS } from "./activation-repaint";

const PAST_LAST_DELAY_MS =
  ACTIVATION_REPAINT_DELAYS_MS[ACTIVATION_REPAINT_DELAYS_MS.length - 1] + 10;
const FIRST_DELAY_MS = ACTIVATION_REPAINT_DELAYS_MS[0];
// One heal per trailing pass (doubt-review MED: a single fixed deadline is the
// fragility #167 already learned to avoid; an early clear is redundant, not harmful).
const HEALS_PER_RESHOW = ACTIVATION_REPAINT_DELAYS_MS.length;

const drain = (): void => {
  act(() => {
    vi.advanceTimersByTime(PAST_LAST_DELAY_MS);
  });
};

describe("useTerminalResize — atlas heal on re-show", () => {
  let h: ResizeHarness;
  beforeEach(() => {
    h = installResizeHarness();
    vi.useFakeTimers();
    setHidden(false);
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.clearAllMocks();
  });

  /**
   * Mount with the Terminal tab ALREADY active and settle the mount-activation
   * passes, so each test observes only its own trigger. (That mount schedule is
   * a harness artefact — see the KNOWN DIVERGENCE note in the harness header.)
   * Returns the harness result with the spies zeroed.
   */
  const mountActive = (): SetupResult => {
    const r = h.setup(true);
    drain();
    r.atlasHeal.mockClear();
    (r.term.refresh as ReturnType<typeof vi.fn>).mockClear();
    return r;
  };

  // --- AC-1a: the window re-show path (the reported trigger) ---

  it("window focus heals the atlas (after the trailing passes settle)", () => {
    const { atlasHeal } = mountActive();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    drain();
    expect(atlasHeal).toHaveBeenCalledTimes(HEALS_PER_RESHOW);
  });

  it("visibilitychange (becoming visible) heals the atlas", () => {
    const { atlasHeal } = mountActive();
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    drain();
    expect(atlasHeal).toHaveBeenCalledTimes(HEALS_PER_RESHOW);
  });

  it("pageshow (bfcache restore) heals the atlas", () => {
    const { atlasHeal } = mountActive();
    act(() => {
      window.dispatchEvent(new Event("pageshow"));
    });
    drain();
    expect(atlasHeal).toHaveBeenCalledTimes(HEALS_PER_RESHOW);
  });

  // --- AC-1b: the in-app tab-activation path (user decision 2026-07-14) ---

  it("Transcript→Terminal tab activation heals the atlas", () => {
    const { atlasHeal, rerender } = h.setup(false);
    rerender(true);
    drain();
    expect(atlasHeal).toHaveBeenCalledTimes(HEALS_PER_RESHOW);
  });

  // --- Invariant 1: deferred, one heal per pass, never synchronous ---

  it("does NOT heal synchronously on the event (the canvas has not composited yet)", () => {
    const { atlasHeal } = mountActive();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(atlasHeal).not.toHaveBeenCalled();
  });

  it("heals on the first pass already, and again on the trailing one", () => {
    const { atlasHeal } = mountActive();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    act(() => {
      vi.advanceTimersByTime(FIRST_DELAY_MS);
    });
    expect(atlasHeal).toHaveBeenCalledTimes(1); // early shot
    drain();
    expect(atlasHeal).toHaveBeenCalledTimes(HEALS_PER_RESHOW); // …plus the late one
  });

  // --- Invariant 2: no heal into a hidden (never-composited) canvas ---

  it("window focus while the Terminal tab is HIDDEN does NOT heal", () => {
    const { atlasHeal } = h.setup(false); // mounted behind the inactive tab
    drain();
    atlasHeal.mockClear();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    drain();
    expect(atlasHeal).not.toHaveBeenCalled();
  });

  it("…and the deferred heal reads `active` at FIRE time, not at schedule time", () => {
    // Refocus while visible, then switch away before the trailing pass lands:
    // the canvas is hidden by the time the heal would run, so it must not.
    const { atlasHeal, rerender } = mountActive();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    rerender(false); // user flips to Transcript within the 350 ms window
    drain();
    expect(atlasHeal).not.toHaveBeenCalled();
  });

  // --- AC-2: an event burst costs ONE set of passes, not one per event ---

  it("a focus + visibilitychange + pageshow burst collapses into ONE set of passes", () => {
    const { atlasHeal } = mountActive();
    act(() => {
      window.dispatchEvent(new Event("focus"));
      document.dispatchEvent(new Event("visibilitychange"));
      window.dispatchEvent(new Event("pageshow"));
    });
    drain();
    // Each event re-schedules the trailing set (cancelling the prior one), so a
    // 3-event burst costs ONE set of passes — not three sets.
    expect(atlasHeal).toHaveBeenCalledTimes(HEALS_PER_RESHOW);
  });

  // --- AC-3: no heal when there is nothing (or nobody) to heal ---

  it("a hidden visibilitychange does NOT heal (no work while hidden)", () => {
    const { atlasHeal } = mountActive();
    setHidden(true);
    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    drain();
    expect(atlasHeal).not.toHaveBeenCalled();
    setHidden(false);
  });

  it("focus after disposal does NOT heal (no clear on a dead term)", () => {
    const { atlasHeal, disposed, rerender } = mountActive();
    disposed.current = true;
    rerender(true);
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    drain();
    expect(atlasHeal).not.toHaveBeenCalled();
  });

  it("a heal queued before unmount never lands after teardown", () => {
    const { atlasHeal, unmount } = mountActive();
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    unmount(); // the hook's cleanup cancels the trailing set
    drain();
    expect(atlasHeal).not.toHaveBeenCalled();
  });

  // --- AC-4: the fences hold — the heal is a re-show remedy, not a data one ---

  it("the ResizeObserver (layout/data stream) path does NOT heal here", () => {
    const { atlasHeal } = mountActive();
    act(() => {
      h.triggerRO();
    });
    drain();
    // A resize already clears the model inside xterm (WebglRenderer.handleResize
    // → _clearModel) — healing again here would pay a re-raster per resize tick.
    expect(atlasHeal).not.toHaveBeenCalled();
  });

  it("the existing refresh passes still run alongside the heal (DOM arm keeps working)", () => {
    const { term, atlasHeal } = mountActive();
    const refresh = term.refresh as ReturnType<typeof vi.fn>;
    act(() => {
      window.dispatchEvent(new Event("focus"));
    });
    drain();
    // 1 synchronous + one per trailing delay — unchanged by this iterate.
    expect(refresh).toHaveBeenCalledTimes(1 + ACTIVATION_REPAINT_DELAYS_MS.length);
    expect(atlasHeal).toHaveBeenCalledTimes(HEALS_PER_RESHOW);
  });
});
