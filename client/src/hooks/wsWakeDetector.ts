/*
 * wsWakeDetector — detect that the tab was frozen (OS sleep / deep throttle) by
 * measuring wall-clock drift between ticks (iterate-2026-07-23-mac-wake-terminal-
 * revive). ZERO React imports; pure timer + clock, unit-tested in isolation.
 *
 * WHY: the WS liveness layer revives a slept-through socket eagerly on
 * focus / pageshow / visibilitychange / online. On macOS a lid-close → unlock
 * fires NONE of those — the whole page freezes and thaws already-visible with
 * the window still focused and the network nominally up — so recovery falls to
 * the ~45 s missed-pong heartbeat and the terminal sits frozen for ~30-60 s
 * until a manual reload (Windows fires one of the events, so it recovers at
 * once; same code, different OS event behaviour).
 *
 * A short-interval timer that compares actual elapsed time against the expected
 * interval fires regardless of which browser events do or don't run: while the
 * machine sleeps the timer is frozen, and the first tick after wake shows a gap
 * far larger than the interval. That gap IS the wake signal, on any OS.
 */

/** How often to sample the clock. Short so the first post-wake tick lands fast. */
export const WS_WAKE_INTERVAL_MS = 2000;

/**
 * A tick gap beyond this ⇒ the tab was frozen (sleep) or deeply throttled, so
 * any socket that reports OPEN is suspect. Comfortably above the interval +
 * normal scheduler jitter; a backgrounded-but-alive tab (Chromium throttles to
 * ~1 tick/min) also crosses it, but that only triggers a probe which a live
 * socket answers — a harmless no-op, never a spurious teardown.
 */
export const WS_WAKE_GAP_MS = 8000;

export interface WakeDetector {
  /** Idempotent teardown. */
  stop(): void;
}

export interface StartWakeDetectorOpts {
  /** Fired once per detected freeze/resume. */
  onWake: () => void;
  /** Clock source (tests inject a controllable one). Defaults to `Date.now`. */
  now?: () => number;
  intervalMs?: number;
  gapMs?: number;
  setIntervalFn?: (handler: () => void, ms: number) => ReturnType<typeof setInterval>;
  clearIntervalFn?: (timer: ReturnType<typeof setInterval>) => void;
}

/**
 * Start sampling. Each tick measures `now() - lastTick`; a gap over `gapMs`
 * fires `onWake` and re-arms (so a second sleep fires again). `stop()` clears
 * the interval and latches, so a stray late timer can never fire `onWake`.
 */
export function startWakeDetector(opts: StartWakeDetectorOpts): WakeDetector {
  const now = opts.now ?? (() => Date.now());
  const intervalMs = opts.intervalMs ?? WS_WAKE_INTERVAL_MS;
  const gapMs = opts.gapMs ?? WS_WAKE_GAP_MS;
  const setI: (handler: () => void, ms: number) => ReturnType<typeof setInterval> =
    opts.setIntervalFn ??
    (setInterval as unknown as (handler: () => void, ms: number) => ReturnType<typeof setInterval>);
  const clearI: (timer: ReturnType<typeof setInterval>) => void =
    opts.clearIntervalFn ??
    (clearInterval as unknown as (timer: ReturnType<typeof setInterval>) => void);

  let lastTick = now();
  let stopped = false;

  const timer = setI(() => {
    if (stopped) return;
    const t = now();
    const gap = t - lastTick;
    lastTick = t;
    if (gap > gapMs) opts.onWake();
  }, intervalMs);

  return {
    stop() {
      if (stopped) return;
      stopped = true;
      clearI(timer);
    },
  };
}
