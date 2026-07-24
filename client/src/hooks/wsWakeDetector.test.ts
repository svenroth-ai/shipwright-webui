/*
 * wsWakeDetector — detect a tab that was frozen (OS sleep / deep throttle) by
 * wall-clock drift (iterate-2026-07-23-mac-wake-terminal-revive).
 *
 * REPRODUCTION of the Mac-only defect: after lid-close → unlock, the embedded
 * terminal sits frozen ~30-60 s until a manual reload. Measured cause: macOS
 * fires NONE of the browser events the eager reconnect hangs on (focus /
 * pageshow / visibilitychange / online) — the page freezes and thaws
 * already-visible with focus intact — so recovery falls to the slow ~45 s
 * missed-pong heartbeat. A clock-drift check fires regardless of events.
 */

import { describe, expect, it, vi } from "vitest";
import {
  startWakeDetector,
  WS_WAKE_GAP_MS,
  WS_WAKE_INTERVAL_MS,
} from "./wsWakeDetector";

/** A capturable fake interval: hold the callback so a test can fire it by hand. */
function harness() {
  let cb: (() => void) | null = null;
  let cleared = false;
  return {
    setIntervalFn: (h: () => void) => {
      cb = h;
      return 1 as unknown as ReturnType<typeof setInterval>;
    },
    clearIntervalFn: () => {
      cleared = true;
    },
    tick: () => cb?.(),
    get cleared() {
      return cleared;
    },
  };
}

describe("startWakeDetector", () => {
  it("does NOT fire on a normal tick (gap ≈ the interval)", () => {
    const h = harness();
    let now = 1000;
    const onWake = vi.fn();
    startWakeDetector({
      onWake,
      now: () => now,
      setIntervalFn: h.setIntervalFn,
      clearIntervalFn: h.clearIntervalFn,
    });
    now = 1000 + WS_WAKE_INTERVAL_MS; // one normal interval elapsed
    h.tick();
    expect(onWake).not.toHaveBeenCalled();
  });

  it("fires on a large gap — the tab was frozen (sleep)", () => {
    const h = harness();
    let now = 1000;
    const onWake = vi.fn();
    startWakeDetector({
      onWake,
      now: () => now,
      setIntervalFn: h.setIntervalFn,
      clearIntervalFn: h.clearIntervalFn,
    });
    // The machine slept: wall-clock jumped far beyond one interval before the
    // next tick ran.
    now = 1000 + WS_WAKE_GAP_MS + 30_000;
    h.tick();
    expect(onWake).toHaveBeenCalledTimes(1);
  });

  it("re-arms after a wake — a SECOND sleep fires again", () => {
    const h = harness();
    let now = 1000;
    const onWake = vi.fn();
    startWakeDetector({
      onWake,
      now: () => now,
      setIntervalFn: h.setIntervalFn,
      clearIntervalFn: h.clearIntervalFn,
    });
    now += WS_WAKE_GAP_MS + 10_000;
    h.tick(); // wake 1
    now += WS_WAKE_INTERVAL_MS;
    h.tick(); // normal — no wake
    now += WS_WAKE_GAP_MS + 10_000;
    h.tick(); // wake 2
    expect(onWake).toHaveBeenCalledTimes(2);
  });

  it("stop() clears the interval and prevents any further wake", () => {
    const h = harness();
    let now = 1000;
    const onWake = vi.fn();
    const d = startWakeDetector({
      onWake,
      now: () => now,
      setIntervalFn: h.setIntervalFn,
      clearIntervalFn: h.clearIntervalFn,
    });
    d.stop();
    expect(h.cleared).toBe(true);
    now += WS_WAKE_GAP_MS + 30_000;
    h.tick(); // a stray late timer must not fire onWake
    expect(onWake).not.toHaveBeenCalled();
  });

  it("stop() is idempotent", () => {
    const h = harness();
    const d = startWakeDetector({
      onWake: vi.fn(),
      now: () => 1000,
      setIntervalFn: h.setIntervalFn,
      clearIntervalFn: h.clearIntervalFn,
    });
    d.stop();
    expect(() => d.stop()).not.toThrow();
  });
});
