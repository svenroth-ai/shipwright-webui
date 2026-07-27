/*
 * wsLiveness — INTERACTION-TRIGGERED REVIVE
 * (iterate-2026-07-27-mac-terminal-fast-dead-socket).
 *
 * The macOS lid-close/lock case, confirmed with the reporter: the page keeps
 * running (no JS freeze → the clock-drift wake detector never fires) but the WS
 * to the host dies silently half-open (no `close`, no focus/visibility/online
 * event). Only the slow ~45 s heartbeat noticed it. The reliable signal on macOS
 * is that the user, on returning, INTERACTS — a keystroke / click always fires a
 * DOM event even when OS-wake events do not. This drives the same reviveIfStale
 * probe, but ONLY when the socket has been inbound-silent long enough to be
 * suspect (a healthy socket pongs on the heartbeat, so normal use never trips).
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import { attachWsLiveness, type WsLivenessController } from "./wsLiveness";
import { WS_INTERACTION_STALE_MS } from "./wsHeartbeat";

const OPEN = 1;

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
const pinged = (s: { sent: string[] }) =>
  s.sent.filter((m) => {
    try {
      return (JSON.parse(m) as { type?: string }).type === "ping";
    } catch {
      return false;
    }
  }).length;

let controller: WsLivenessController | null = null;
afterEach(() => {
  controller?.dispose();
  controller = null;
});

function setup(socketRef: { current: ReturnType<typeof fakeSocket> | null }) {
  let now = 100_000;
  const reconnect = vi.fn();
  controller = attachWsLiveness({
    getSocket: () => socketRef.current,
    openState: OPEN,
    isReplayOnly: () => false,
    isCancelled: () => false,
    rearmBudget: vi.fn(),
    reconnect,
    nowFn: () => now,
    // No real timers: neutralise the heartbeat + wake-detector interval seams.
    setIntervalFn: () => 0 as unknown as ReturnType<typeof setInterval>,
    clearIntervalFn: () => {},
    setTimeoutFn: () => 0 as unknown as ReturnType<typeof setTimeout>,
    clearTimeoutFn: () => {},
  });
  return {
    reconnect,
    advance: (ms: number) => {
      now += ms;
    },
    noteInbound: () => controller!.noteInbound(),
    keydown: () => document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true })),
    pointerdown: () => document.dispatchEvent(new Event("pointerdown", { bubbles: true })),
  };
}

describe("wsLiveness — interaction-triggered revive", () => {
  it("a keystroke on an inbound-SILENT OPEN socket probes it (the dead-socket case)", () => {
    const socketRef = { current: fakeSocket(OPEN) };
    const t = setup(socketRef);
    t.advance(WS_INTERACTION_STALE_MS + 1_000); // no pong for longer than the stale window
    t.keydown();
    expect(pinged(socketRef.current!)).toBe(1); // reviveIfStale → probe ping
  });

  it("a click behaves the same as a keystroke", () => {
    const socketRef = { current: fakeSocket(OPEN) };
    const t = setup(socketRef);
    t.advance(WS_INTERACTION_STALE_MS + 1_000);
    t.pointerdown();
    expect(pinged(socketRef.current!)).toBe(1);
  });

  it("does NOTHING on a healthy socket (recent inbound) — normal typing must not churn", () => {
    const socketRef = { current: fakeSocket(OPEN) };
    const t = setup(socketRef);
    t.advance(WS_INTERACTION_STALE_MS + 1_000);
    t.noteInbound(); // a pong just arrived → socket is fresh
    t.keydown();
    expect(pinged(socketRef.current!)).toBe(0);
  });

  it("throttles: rapid keystrokes on a dead socket do not re-arm the probe every keystroke", () => {
    const socketRef = { current: fakeSocket(OPEN) };
    const t = setup(socketRef);
    t.advance(WS_INTERACTION_STALE_MS + 1_000);
    t.keydown();
    t.keydown();
    t.keydown();
    expect(pinged(socketRef.current!)).toBe(1); // only the first within the throttle window acts
  });

  it("with NO socket, a keystroke on a stale attach reconnects immediately", () => {
    const socketRef = { current: null as ReturnType<typeof fakeSocket> | null };
    const t = setup(socketRef);
    t.advance(WS_INTERACTION_STALE_MS + 1_000);
    t.keydown();
    expect(t.reconnect).toHaveBeenCalledTimes(1);
  });

  it("dispose() unbinds the interaction listeners", () => {
    const socketRef = { current: fakeSocket(OPEN) };
    const t = setup(socketRef);
    controller!.dispose();
    controller = null;
    t.advance(WS_INTERACTION_STALE_MS + 1_000);
    t.keydown();
    expect(pinged(socketRef.current!)).toBe(0);
  });
});
