/*
 * wsLiveness — WAKE-DETECTOR WIRING (iterate-2026-07-23-mac-wake-terminal-revive).
 *
 * Proves attachWsLiveness runs its revive path off the clock-drift wake detector,
 * not only off browser events — the macOS lid-close→unlock case, where no
 * focus/visibility/online event fires and the socket is left half-open.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { attachWsLiveness } from "./wsLiveness";
import { WS_WAKE_GAP_MS, WS_WAKE_INTERVAL_MS } from "./wsWakeDetector";

const OPEN = 1;

/** Fake socket exposing what the liveness controller touches. */
function fakeSocket(readyState = OPEN) {
  return {
    readyState,
    sent: [] as string[],
    send(d: string) {
      this.sent.push(d);
    },
    close: vi.fn(),
  };
}

function pinged(s: { sent: string[] }): boolean {
  return s.sent.some((m) => {
    try {
      return (JSON.parse(m) as { type?: string }).type === "ping";
    } catch {
      return false;
    }
  });
}

/**
 * Build a controller whose wake detector is driven by an injected clock + a
 * capturable interval, so a test can fire ticks by hand with a controlled gap.
 */
function setup(socketRef: { current: ReturnType<typeof fakeSocket> | null }) {
  let wakeTick: (() => void) | null = null;
  let now = 1000;
  const reconnect = vi.fn();
  const rearmBudget = vi.fn();
  const controller = attachWsLiveness({
    getSocket: () => socketRef.current,
    openState: OPEN,
    isReplayOnly: () => false,
    isCancelled: () => false,
    rearmBudget,
    reconnect,
    nowFn: () => now,
    // The only interval registered here is the wake detector (we never call
    // onConnected, so no heartbeat interval competes for the capture slot).
    setIntervalFn: (h: () => void) => {
      wakeTick = h;
      return 1 as unknown as ReturnType<typeof setInterval>;
    },
    clearIntervalFn: () => {},
    // Probe timer — captured but never auto-fired; the test asserts the ping.
    setTimeoutFn: () => 2 as unknown as ReturnType<typeof setTimeout>,
    clearTimeoutFn: () => {},
  });
  return {
    controller,
    reconnect,
    rearmBudget,
    normalTick: () => {
      now += WS_WAKE_INTERVAL_MS;
      wakeTick?.();
    },
    sleepTick: () => {
      now += WS_WAKE_GAP_MS + 30_000;
      wakeTick?.();
    },
  };
}

describe("wsLiveness — wake-detector wiring", () => {
  afterEach(() => vi.restoreAllMocks());

  it("a detected wake PROBES an OPEN-but-stale socket (no browser event needed)", () => {
    const socketRef = { current: fakeSocket(OPEN) };
    const t = setup(socketRef);
    t.normalTick();
    expect(pinged(socketRef.current!)).toBe(false); // normal tick → nothing
    t.sleepTick();
    expect(pinged(socketRef.current!)).toBe(true); // wake → reviveIfStale → probe
    t.controller.dispose();
  });

  it("a detected wake with NO socket reconnects immediately", () => {
    const socketRef = { current: null as ReturnType<typeof fakeSocket> | null };
    const t = setup(socketRef);
    t.sleepTick();
    expect(t.reconnect).toHaveBeenCalledTimes(1);
    t.controller.dispose();
  });

  it("dispose() stops the detector — a later tick does nothing", () => {
    const socketRef = { current: fakeSocket(OPEN) };
    const t = setup(socketRef);
    t.controller.dispose();
    t.sleepTick();
    expect(pinged(socketRef.current!)).toBe(false);
  });
});
