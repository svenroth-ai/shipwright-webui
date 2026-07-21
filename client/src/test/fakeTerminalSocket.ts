/*
 * Shared test harness for the terminal-WS liveness specs
 * (iterate-2026-06-18-terminal-ws-reconnect-refocus).
 *
 * An in-memory FakeWebSocket + fake-timer setup used by both
 * useTerminalSocket.heartbeat.test.ts and useTerminalSocket.refocus.test.ts.
 * The fake supports a per-construct mode so a spec can drive:
 *   - "open" — opens on the next microtask (healthy connect);
 *   - "fail" — fires error+close(1006) instead of open (a failed reconnect
 *     attempt, so the reconnect budget genuinely exhausts — a real failed
 *     connect never fires `open`);
 *   - "hang" — stays CONNECTING forever (an in-flight attempt).
 */

import { act } from "@testing-library/react";
import { vi } from "vitest";

export class FakeWebSocket {
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

/**
 * Install fake timers + the FakeWebSocket global + a localhost location.
 * Returns the teardown to call in afterEach.
 */
export function installFakeWebSocket(): () => void {
  vi.useFakeTimers();
  const realWebSocket = globalThis.WebSocket;
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
  return () => {
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      writable: true,
      value: realWebSocket,
    });
    FakeWebSocket.reset();
    vi.useRealTimers();
  };
}

/** Count of `{type:"ping"}` frames sent on a socket. */
export const pings = (ws: FakeWebSocket): string[] =>
  ws.sent.filter((s) => {
    try {
      return (JSON.parse(s) as { type?: string }).type === "ping";
    } catch {
      return false;
    }
  });

/** Flush the microtask queue (FakeWebSocket opens via queueMicrotask). */
export async function flush(): Promise<void> {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

/** Advance fake timers (wrapped in act for React state flushing). */
export async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

/**
 * Kill the live socket and make every reconnect fail -> spend the fast ramp.
 * Returns the instance count once the 5-attempt ramp
 * (`BACKOFF_MS`, ~6.2 s) is spent.
 *
 * NOTE (iterate-2026-07-21-mac-sleep-terminal-frozen): the ramp is no longer a
 * hard cap — a `WS_RECONNECT_TAIL_MS` retry keeps running afterwards, so this
 * does NOT leave the client inert. The 8 s advance below lands before the first
 * tail retry (ramp ends ~6.2 s, tail fires ~11.2 s), which is why the returned
 * count is still exactly ramp+1.
 */
export async function exhaustBudget(): Promise<number> {
  FakeWebSocket.nextMode = "fail";
  await act(async () => {
    FakeWebSocket.last.__close();
  });
  await advance(8000); // cascade through all 5 backoff attempts
  return FakeWebSocket.instances.length;
}
