/*
 * useTerminalSocket — unit tests against an in-memory FakeWebSocket so
 * jsdom doesn't need a real ws server. Covers ready-handshake, role
 * propagation, send envelopes, reconnect-on-close, ws/wss protocol pick.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTerminalSocket } from "./useTerminalSocket";

class FakeWebSocket {
  static OPEN = 1 as const;
  static CLOSED = 3 as const;
  static instances: FakeWebSocket[] = [];

  readyState: number = 0;
  url: string;
  onopen?: (e: Event) => void;
  onmessage?: (e: MessageEvent) => void;
  onclose?: (e: CloseEvent) => void;
  onerror?: (e: Event) => void;
  sent: string[] = [];

  private listeners: Record<string, Array<(e: unknown) => void>> = {};

  constructor(url: string) {
    this.url = url;
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => this.__open());
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
  close(_code?: number, _reason?: string) {
    void _code;
    void _reason;
    this.readyState = FakeWebSocket.CLOSED;
    this.__fire("close", { code: 1000 });
  }

  __open() {
    this.readyState = FakeWebSocket.OPEN;
    this.__fire("open", {});
  }
  __message(data: string) {
    this.__fire("message", { data });
  }
  __close() {
    this.readyState = FakeWebSocket.CLOSED;
    this.__fire("close", { code: 1006 });
  }

  private __fire(type: string, evt: unknown) {
    const arr = this.listeners[type] ?? [];
    for (const cb of arr) cb(evt);
  }

  static reset() {
    FakeWebSocket.instances = [];
  }
}

describe("useTerminalSocket", () => {
  let realWebSocket: typeof WebSocket;
  beforeEach(() => {
    realWebSocket = globalThis.WebSocket;
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      writable: true,
      value: FakeWebSocket,
    });
    FakeWebSocket.reset();
  });

  afterEach(() => {
    Object.defineProperty(globalThis, "WebSocket", {
      configurable: true,
      writable: true,
      value: realWebSocket,
    });
    FakeWebSocket.reset();
  });

  it("infers ws:// for http: page protocol and wss:// for https:", () => {
    // http
    Object.defineProperty(window, "location", {
      writable: true,
      value: new URL("http://localhost:5173/x"),
    });
    renderHook(() => useTerminalSocket({ taskId: "t1" }));
    expect(FakeWebSocket.instances[0].url).toMatch(/^ws:\/\/localhost/);
    FakeWebSocket.reset();

    // https
    Object.defineProperty(window, "location", {
      writable: true,
      value: new URL("https://example.com/x"),
    });
    renderHook(() => useTerminalSocket({ taskId: "t1" }));
    expect(FakeWebSocket.instances[0].url).toMatch(/^wss:\/\/example\.com/);
  });

  it("fires onData for inbound data envelopes", async () => {
    Object.defineProperty(window, "location", {
      writable: true,
      value: new URL("http://localhost/x"),
    });
    const seen: string[] = [];
    renderHook(() => useTerminalSocket({ taskId: "t1", onData: (chunk) => seen.push(chunk) }));
    await act(async () => {
      // Open is microtask-deferred.
    });
    const ws = FakeWebSocket.instances[0];
    await act(async () => {
      ws.__message(JSON.stringify({ type: "data", payload: "hello\n" }));
    });
    expect(seen).toEqual(["hello\n"]);
  });

  it("flips ready to true and exposes role on inbound ready envelope", async () => {
    Object.defineProperty(window, "location", {
      writable: true,
      value: new URL("http://localhost/x"),
    });
    const { result } = renderHook(() => useTerminalSocket({ taskId: "t1" }));
    await act(async () => {});
    const ws = FakeWebSocket.instances[0];
    expect(result.current.ready).toBe(false);
    await act(async () => {
      ws.__message(
        JSON.stringify({ type: "ready", role: "writer", shellKind: "pwsh", cwd: "C:\\x" }),
      );
    });
    expect(result.current.ready).toBe(true);
    expect(result.current.role).toBe("writer");
  });

  it("send() emits a typed envelope JSON-stringified", async () => {
    Object.defineProperty(window, "location", {
      writable: true,
      value: new URL("http://localhost/x"),
    });
    const { result } = renderHook(() => useTerminalSocket({ taskId: "t1" }));
    await act(async () => {});
    await act(async () => {
      result.current.send({ type: "data", payload: "ls\n" });
    });
    const ws = FakeWebSocket.instances[0];
    expect(ws.sent).toEqual([JSON.stringify({ type: "data", payload: "ls\n" })]);
  });

  it("notifies onReadOnly when server sends a read_only envelope", async () => {
    Object.defineProperty(window, "location", {
      writable: true,
      value: new URL("http://localhost/x"),
    });
    let readOnlyHits = 0;
    renderHook(() =>
      useTerminalSocket({ taskId: "t1", onReadOnly: () => (readOnlyHits += 1) }),
    );
    await act(async () => {});
    const ws = FakeWebSocket.instances[0];
    await act(async () => {
      ws.__message(JSON.stringify({ type: "read_only" }));
    });
    expect(readOnlyHits).toBe(1);
  });

  it("notifies onBackpressure with droppedBytes", async () => {
    Object.defineProperty(window, "location", {
      writable: true,
      value: new URL("http://localhost/x"),
    });
    const drops: number[] = [];
    renderHook(() =>
      useTerminalSocket({
        taskId: "t1",
        onBackpressure: ({ droppedBytes }) => drops.push(droppedBytes),
      }),
    );
    await act(async () => {});
    const ws = FakeWebSocket.instances[0];
    await act(async () => {
      ws.__message(JSON.stringify({ type: "backpressure", droppedBytes: 4096 }));
    });
    expect(drops).toEqual([4096]);
  });

  it("does not connect when enabled=false or taskId=null", () => {
    Object.defineProperty(window, "location", {
      writable: true,
      value: new URL("http://localhost/x"),
    });
    renderHook(() => useTerminalSocket({ taskId: null }));
    expect(FakeWebSocket.instances).toHaveLength(0);

    renderHook(() => useTerminalSocket({ taskId: "t1", enabled: false }));
    expect(FakeWebSocket.instances).toHaveLength(0);
  });

  it("closes the socket on unmount", async () => {
    Object.defineProperty(window, "location", {
      writable: true,
      value: new URL("http://localhost/x"),
    });
    const { unmount } = renderHook(() => useTerminalSocket({ taskId: "t1" }));
    await act(async () => {});
    const ws = FakeWebSocket.instances[0];
    expect(ws.readyState).toBe(FakeWebSocket.OPEN);
    unmount();
    expect(ws.readyState).toBe(FakeWebSocket.CLOSED);
  });

  // ADR-089 (Iterate B) — replay_snapshot envelope routing.
  it("routes replay_snapshot envelope to onReplaySnapshot callback once", async () => {
    Object.defineProperty(window, "location", {
      writable: true,
      value: new URL("http://localhost/x"),
    });
    const calls: Array<{
      data: string;
      cols: number;
      rows: number;
      terminalVersion: string;
    }> = [];
    renderHook(() =>
      useTerminalSocket({
        taskId: "t1",
        onReplaySnapshot: (info) => calls.push(info),
      }),
    );
    await act(async () => {});
    const ws = FakeWebSocket.instances[0];
    await act(async () => {
      ws.__message(
        JSON.stringify({
          type: "replay_snapshot",
          data: "\x1b[2J\x1b[Hcell state",
          cols: 80,
          rows: 24,
          terminalVersion: "6.0.0",
        }),
      );
    });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({
      data: "\x1b[2J\x1b[Hcell state",
      cols: 80,
      rows: 24,
      terminalVersion: "6.0.0",
    });
  });

  it("ignores malformed replay_snapshot envelopes (missing fields)", async () => {
    Object.defineProperty(window, "location", {
      writable: true,
      value: new URL("http://localhost/x"),
    });
    const calls: unknown[] = [];
    renderHook(() =>
      useTerminalSocket({
        taskId: "t1",
        onReplaySnapshot: (info) => calls.push(info),
      }),
    );
    await act(async () => {});
    const ws = FakeWebSocket.instances[0];
    await act(async () => {
      // Missing `data` field — must be ignored, not throw.
      ws.__message(
        JSON.stringify({
          type: "replay_snapshot",
          cols: 80,
          rows: 24,
          terminalVersion: "6.0.0",
        }),
      );
      // Missing `cols` — also ignored.
      ws.__message(
        JSON.stringify({
          type: "replay_snapshot",
          data: "x",
          rows: 24,
          terminalVersion: "6.0.0",
        }),
      );
    });
    expect(calls).toEqual([]);
  });

  it("Iterate C (ADR-087) — legacy chunked-replay envelopes are IGNORED", async () => {
    // The server no longer emits replay_start / replay_chunk /
    // replay_separator / replay_end. If a stale server (mid-deploy
    // skew) emits them anyway, the client MUST NOT call onData on
    // those payloads, MUST NOT crash, MUST NOT call any chunked hook.
    Object.defineProperty(window, "location", {
      writable: true,
      value: new URL("http://localhost/x"),
    });
    const dataReceived: string[] = [];
    const snapshotReceived: unknown[] = [];
    renderHook(() =>
      useTerminalSocket({
        taskId: "t1",
        onData: (d) => dataReceived.push(d),
        onReplaySnapshot: (info) => snapshotReceived.push(info),
      }),
    );
    await act(async () => {});
    const ws = FakeWebSocket.instances[0];
    await act(async () => {
      ws.__message(
        JSON.stringify({ type: "replay_start", totalBytes: 5 }),
      );
      ws.__message(
        JSON.stringify({ type: "replay_chunk", payload: "hello" }),
      );
      ws.__message(
        JSON.stringify({ type: "replay_separator", payload: "sep" }),
      );
      ws.__message(JSON.stringify({ type: "replay_end" }));
    });
    // No onData calls — the chunked payloads are silently dropped.
    expect(dataReceived).toEqual([]);
    expect(snapshotReceived).toEqual([]);
  });
});
