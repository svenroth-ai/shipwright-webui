/*
 * useTerminalSocket — heartbeat + reconnect-on-refocus behaviour.
 *
 * Separate file from useTerminalSocket.test.ts (which is at the bloat
 * ceiling). Covers the iterate-2026-06-18 fix:
 *   AC-1 periodic heartbeat ping
 *   AC-2 any inbound message resets liveness
 *   AC-3 a silently-dead OPEN socket is reaped + reconnected
 *   AC-4 a visibility/focus regain re-arms an exhausted reconnect budget
 *   AC-5 an eager refocus probe closes an OPEN-but-dead socket
 *   AC-6 a replay-only (done) attach is NEVER reconnected on refocus
 *
 * Uses fake timers; the in-memory FakeWebSocket supports a per-construct
 * "fail" mode so the reconnect budget can be genuinely exhausted (a real
 * failed connect never fires `open`, so attemptsRef keeps climbing).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTerminalSocket } from "./useTerminalSocket";
import { WS_HEARTBEAT_INTERVAL_MS, WS_REFOCUS_PROBE_MS } from "./wsHeartbeat";

class FakeWebSocket {
  static CONNECTING = 0 as const;
  static OPEN = 1 as const;
  static CLOSING = 2 as const;
  static CLOSED = 3 as const;
  static instances: FakeWebSocket[] = [];
  /** Per-construct behaviour, consumed on construction. */
  static nextMode: "open" | "fail" | "hang" = "open";

  readyState: number = 0;
  url: string;
  sent: string[] = [];
  private listeners: Record<string, Array<(e: unknown) => void>> = {};

  constructor(url: string) {
    this.url = url;
    const mode = FakeWebSocket.nextMode;
    FakeWebSocket.instances.push(this);
    if (mode === "hang") return; // stays CONNECTING forever (in-flight attempt)
    queueMicrotask(() => {
      if (mode === "fail") {
        this.__fire("error", {});
        this.readyState = FakeWebSocket.CLOSED;
        this.__fire("close", { code: 1006 });
      } else {
        this.readyState = FakeWebSocket.OPEN;
        this.__fire("open", {});
      }
    });
  }

  addEventListener(type: string, cb: (e: unknown) => void) {
    (this.listeners[type] ??= []).push(cb);
  }
  removeEventListener(type: string, cb: (e: unknown) => void) {
    const arr = this.listeners[type];
    if (!arr) return;
    const i = arr.indexOf(cb);
    if (i !== -1) arr.splice(i, 1);
  }
  send(data: string) {
    this.sent.push(data);
  }
  close(code?: number) {
    this.readyState = FakeWebSocket.CLOSED;
    this.__fire("close", { code: code ?? 1000 });
  }
  __message(data: string) {
    this.__fire("message", { data });
  }
  __close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.__fire("close", { code: 1006 });
  }
  private __fire(type: string, evt: unknown) {
    for (const cb of this.listeners[type] ?? []) cb(evt);
  }
  static reset() {
    FakeWebSocket.instances = [];
    FakeWebSocket.nextMode = "open";
  }
  static get last() {
    return FakeWebSocket.instances[FakeWebSocket.instances.length - 1];
  }
}

const pings = (ws: FakeWebSocket) =>
  ws.sent.filter((s) => {
    try {
      return (JSON.parse(s) as { type?: string }).type === "ping";
    } catch {
      return false;
    }
  });

async function flush() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}
async function advance(ms: number) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/** Kill the live socket and make every reconnect fail -> exhaust the budget. */
async function exhaustBudget(): Promise<number> {
  FakeWebSocket.nextMode = "fail";
  await act(async () => {
    FakeWebSocket.last.__close();
  });
  await advance(8000); // cascade through all 5 backoff attempts
  return FakeWebSocket.instances.length;
}

describe("useTerminalSocket — heartbeat + reconnect-on-refocus", () => {
  let realWebSocket: typeof WebSocket;
  beforeEach(() => {
    vi.useFakeTimers();
    realWebSocket = globalThis.WebSocket;
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      writable: true,
      value: FakeWebSocket,
    });
    FakeWebSocket.reset();
    Object.defineProperty(window, "location", {
      writable: true,
      value: new URL("http://localhost/x"),
    });
  });
  afterEach(() => {
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      writable: true,
      value: realWebSocket,
    });
    FakeWebSocket.reset();
    vi.useRealTimers();
  });

  it("AC-1: emits a ping envelope on each heartbeat interval", async () => {
    renderHook(() => useTerminalSocket({ taskId: "t1" }));
    await flush();
    const ws = FakeWebSocket.last;
    expect(ws.readyState).toBe(FakeWebSocket.OPEN);
    await advance(WS_HEARTBEAT_INTERVAL_MS + 10);
    expect(pings(ws).length).toBe(1);
    await advance(WS_HEARTBEAT_INTERVAL_MS + 10);
    expect(pings(ws).length).toBe(2);
  });

  it("AC-2: any inbound message resets the missed-pong run (no reap while alive)", async () => {
    renderHook(() => useTerminalSocket({ taskId: "t1" }));
    await flush();
    const ws = FakeWebSocket.last;
    // Several intervals, each answered by an inbound message -> never reaped.
    for (let i = 0; i < 5; i++) {
      await advance(WS_HEARTBEAT_INTERVAL_MS + 10);
      await act(async () => {
        ws.__message(JSON.stringify({ type: "pong" }));
      });
    }
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(ws.readyState).toBe(FakeWebSocket.OPEN);
  });

  it("AC-3: reaps a silently-dead OPEN socket and reconnects", async () => {
    renderHook(() => useTerminalSocket({ taskId: "t1" }));
    await flush();
    const ws1 = FakeWebSocket.last;
    // No pong ever -> after MAX_MISSED+1 intervals the socket is closed.
    await advance(WS_HEARTBEAT_INTERVAL_MS * 3 + 30);
    expect(ws1.readyState).toBe(FakeWebSocket.CLOSED);
    // close -> reconnect backoff -> a fresh socket opens.
    await advance(500);
    expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
  });

  // AC-4 — each of the three regain triggers re-arms the budget + reconnects.
  // All three must be wired (a missing listener would otherwise pass).
  for (const trigger of [
    { name: "focus", fire: () => window.dispatchEvent(new Event("focus")) },
    { name: "pageshow", fire: () => window.dispatchEvent(new Event("pageshow")) },
    {
      name: "visibilitychange",
      fire: () => document.dispatchEvent(new Event("visibilitychange")),
    },
  ]) {
    it(`AC-4 (${trigger.name}): regain re-arms an exhausted budget and reconnects`, async () => {
      renderHook(() => useTerminalSocket({ taskId: "t1" }));
      await flush();
      const exhausted = await exhaustBudget();
      // Further time does nothing — budget is spent.
      await advance(8000);
      expect(FakeWebSocket.instances.length).toBe(exhausted);
      // Returning to the tab re-arms the budget and reconnects.
      FakeWebSocket.nextMode = "open";
      await act(async () => {
        trigger.fire();
      });
      await flush();
      expect(FakeWebSocket.instances.length).toBeGreaterThan(exhausted);
      expect(FakeWebSocket.last.readyState).toBe(FakeWebSocket.OPEN);
    });
  }

  it("AC-4d: a refocus while a reconnect is in flight (CONNECTING) does NOT double-connect", async () => {
    renderHook(() => useTerminalSocket({ taskId: "t1" }));
    await flush();
    // Drop the live socket; the next reconnect attempt hangs in CONNECTING.
    FakeWebSocket.nextMode = "hang";
    await act(async () => {
      FakeWebSocket.last.__close();
    });
    await advance(500); // fire the backoff -> a CONNECTING socket is created
    const inFlight = FakeWebSocket.instances.length;
    expect(FakeWebSocket.last.readyState).toBe(FakeWebSocket.CONNECTING);
    // Refocus must NOT spawn a second socket (would orphan the in-flight one).
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await flush();
    expect(FakeWebSocket.instances.length).toBe(inFlight);
  });

  it("AC-5: an eager refocus probe closes an OPEN-but-dead socket", async () => {
    renderHook(() => useTerminalSocket({ taskId: "t1" }));
    await flush();
    const ws1 = FakeWebSocket.last;
    await act(async () => {
      ws1.__message(
        JSON.stringify({ type: "ready", role: "writer", shellKind: "pwsh", cwd: "C:\\x" }),
      );
    });
    // Socket still reports OPEN, but the peer is dead. A focus regain probes.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(pings(ws1).length).toBeGreaterThanOrEqual(1); // eager probe ping
    // No inbound answer within the probe deadline -> close + reconnect.
    await advance(WS_REFOCUS_PROBE_MS + 50);
    expect(ws1.readyState).toBe(FakeWebSocket.CLOSED);
    await advance(500);
    expect(FakeWebSocket.instances.length).toBeGreaterThan(1);
  });

  it("AC-5b: an eager refocus probe does NOT close a socket that answers in time", async () => {
    renderHook(() => useTerminalSocket({ taskId: "t1" }));
    await flush();
    const ws1 = FakeWebSocket.last;
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    // Peer answers before the deadline.
    await act(async () => {
      ws1.__message(JSON.stringify({ type: "pong" }));
    });
    await advance(WS_REFOCUS_PROBE_MS + 50);
    expect(ws1.readyState).toBe(FakeWebSocket.OPEN);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("AC-5c: a stale probe timer does NOT close a healthy reconnected socket", async () => {
    renderHook(() => useTerminalSocket({ taskId: "t1" }));
    await flush();
    const ws1 = FakeWebSocket.last;
    await act(async () => {
      ws1.__message(
        JSON.stringify({ type: "ready", role: "writer", shellKind: "pwsh", cwd: "C:\\x" }),
      );
    });
    // Arm an eager probe on ws1 (socket looks OPEN).
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(pings(ws1).length).toBeGreaterThanOrEqual(1);
    // ws1 dies for an unrelated reason; a fresh healthy ws2 reconnects within
    // the 4s probe window. ws2 receives no inbound yet.
    await act(async () => {
      ws1.__close();
    });
    await advance(500); // backoff -> ws2 opens (mode "open")
    const ws2 = FakeWebSocket.last;
    expect(ws2).not.toBe(ws1);
    expect(ws2.readyState).toBe(FakeWebSocket.OPEN);
    // Let the ORIGINAL probe deadline elapse — it must not touch ws2.
    await advance(WS_REFOCUS_PROBE_MS + 100);
    expect(ws2.readyState).toBe(FakeWebSocket.OPEN);
  });

  it("AC-6: a focus regain NEVER reconnects a replay-only (done) attach", async () => {
    renderHook(() => useTerminalSocket({ taskId: "t1" }));
    await flush();
    const ws1 = FakeWebSocket.last;
    await act(async () => {
      ws1.__message(
        JSON.stringify({
          type: "ready",
          role: "reader",
          shellKind: null,
          cwd: "C:\\x",
          replayOnly: true,
        }),
      );
      ws1.close(1000); // server one-shot close after the snapshot
    });
    expect(FakeWebSocket.instances).toHaveLength(1);
    // Returning to the tab must not resurrect a finished session.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    await advance(WS_REFOCUS_PROBE_MS + 1000);
    expect(FakeWebSocket.instances).toHaveLength(1);
  });
});
