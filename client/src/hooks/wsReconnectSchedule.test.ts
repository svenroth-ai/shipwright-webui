/*
 * wsReconnectSchedule — reconnect timing policy + stuck-attempt watchdog
 * (iterate-2026-07-21-mac-sleep-terminal-frozen).
 *
 * The policy replaced a hard 5-attempt cap whose real defect was not its RATE
 * but its TERMINATION: once spent, nothing was left armed that could notice the
 * network coming back, and the terminal stayed frozen until a tab reload.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  BACKOFF_MS,
  createConnectWatchdog,
  isSlowTail,
  nextReconnectDelay,
} from "./wsReconnectSchedule";
import {
  WS_CONNECT_TIMEOUT_MS,
  WS_RECONNECT_TAIL_MS,
  WS_RECONNECT_TAIL_SLOW_AFTER,
  WS_RECONNECT_TAIL_SLOW_MS,
} from "./wsHeartbeat";

const SLOW_FROM = BACKOFF_MS.length + WS_RECONNECT_TAIL_SLOW_AFTER;

describe("nextReconnectDelay", () => {
  it("walks the fast ramp for the first attempts", () => {
    expect(BACKOFF_MS.map((_, i) => nextReconnectDelay(i))).toEqual(BACKOFF_MS);
  });

  it("settles into the calm tail once the ramp is spent", () => {
    expect(nextReconnectDelay(BACKOFF_MS.length)).toBe(WS_RECONNECT_TAIL_MS);
    expect(nextReconnectDelay(SLOW_FROM - 1)).toBe(WS_RECONNECT_TAIL_MS);
  });

  it("backs off to the slow tail for an outage that stops looking transient", () => {
    expect(nextReconnectDelay(SLOW_FROM)).toBe(WS_RECONNECT_TAIL_SLOW_MS);
    expect(nextReconnectDelay(SLOW_FROM + 500)).toBe(WS_RECONNECT_TAIL_SLOW_MS);
  });

  it("NEVER returns a non-positive delay — there is no 'give up' value", () => {
    // The whole defect was a schedule that could stop. Probe far past any
    // plausible attempt count.
    for (const attempt of [0, 4, 5, 17, 100, 10_000, 1_000_000]) {
      expect(nextReconnectDelay(attempt)).toBeGreaterThan(0);
      expect(Number.isFinite(nextReconnectDelay(attempt))).toBe(true);
    }
  });

  it("is monotonically non-decreasing (no cadence regression mid-outage)", () => {
    let prev = 0;
    for (let a = 0; a < SLOW_FROM + 5; a++) {
      const d = nextReconnectDelay(a);
      expect(d).toBeGreaterThanOrEqual(prev);
      prev = d;
    }
  });
});

describe("isSlowTail", () => {
  it("flips exactly at the slow-tail boundary", () => {
    expect(isSlowTail(SLOW_FROM - 1)).toBe(false);
    expect(isSlowTail(SLOW_FROM)).toBe(true);
  });

  it("agrees with nextReconnectDelay", () => {
    for (let a = 0; a < SLOW_FROM + 3; a++) {
      expect(isSlowTail(a)).toBe(
        nextReconnectDelay(a) === WS_RECONNECT_TAIL_SLOW_MS,
      );
    }
  });
});

describe("createConnectWatchdog", () => {
  const CONNECTING = 0;
  const OPEN = 1;

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  function makeSocket(readyState = CONNECTING) {
    return { readyState, close: vi.fn() };
  }

  it("closes an attempt still stuck in CONNECTING", () => {
    const ws = makeSocket();
    const wd = createConnectWatchdog({
      connectingState: CONNECTING,
      isCancelled: () => false,
      isCurrent: () => true,
    });
    wd.arm(ws);
    vi.advanceTimersByTime(WS_CONNECT_TIMEOUT_MS + 1);
    expect(ws.close).toHaveBeenCalledTimes(1);
  });

  it("leaves an attempt that connected alone", () => {
    const ws = makeSocket(OPEN);
    const wd = createConnectWatchdog({
      connectingState: CONNECTING,
      isCancelled: () => false,
      isCurrent: () => true,
    });
    wd.arm(ws);
    vi.advanceTimersByTime(WS_CONNECT_TIMEOUT_MS + 1);
    expect(ws.close).not.toHaveBeenCalled();
  });

  it("never touches an attempt that was superseded", () => {
    const ws = makeSocket();
    const wd = createConnectWatchdog({
      connectingState: CONNECTING,
      isCancelled: () => false,
      isCurrent: () => false, // a newer socket took over
    });
    wd.arm(ws);
    vi.advanceTimersByTime(WS_CONNECT_TIMEOUT_MS + 1);
    expect(ws.close).not.toHaveBeenCalled();
  });

  it("does nothing after the owning effect was cancelled", () => {
    const ws = makeSocket();
    const wd = createConnectWatchdog({
      connectingState: CONNECTING,
      isCancelled: () => true,
      isCurrent: () => true,
    });
    wd.arm(ws);
    vi.advanceTimersByTime(WS_CONNECT_TIMEOUT_MS + 1);
    expect(ws.close).not.toHaveBeenCalled();
  });

  it("clear() disarms, and is idempotent", () => {
    const ws = makeSocket();
    const wd = createConnectWatchdog({
      connectingState: CONNECTING,
      isCancelled: () => false,
      isCurrent: () => true,
    });
    wd.arm(ws);
    wd.clear();
    wd.clear();
    vi.advanceTimersByTime(WS_CONNECT_TIMEOUT_MS + 1);
    expect(ws.close).not.toHaveBeenCalled();
  });

  it("re-arming replaces the prior attempt's timer", () => {
    const first = makeSocket();
    const second = makeSocket();
    let current: typeof first = first;
    const wd = createConnectWatchdog({
      connectingState: CONNECTING,
      isCancelled: () => false,
      isCurrent: (ws) => ws === current,
    });
    wd.arm(first);
    current = second;
    wd.arm(second);
    vi.advanceTimersByTime(WS_CONNECT_TIMEOUT_MS + 1);
    // Only ONE timer may survive — the first must not fire at all.
    expect(first.close).not.toHaveBeenCalled();
    expect(second.close).toHaveBeenCalledTimes(1);
  });

  it("swallows a throw from close() — teardown must not explode", () => {
    const ws = {
      readyState: CONNECTING,
      close: vi.fn(() => {
        throw new Error("already closing");
      }),
    };
    const wd = createConnectWatchdog({
      connectingState: CONNECTING,
      isCancelled: () => false,
      isCurrent: () => true,
    });
    wd.arm(ws);
    expect(() => vi.advanceTimersByTime(WS_CONNECT_TIMEOUT_MS + 1)).not.toThrow();
  });
});
