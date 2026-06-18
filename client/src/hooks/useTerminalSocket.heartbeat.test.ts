/*
 * useTerminalSocket — client liveness HEARTBEAT behaviour
 * (iterate-2026-06-18-terminal-ws-reconnect-refocus).
 *
 * Separate file from useTerminalSocket.test.ts (at the bloat ceiling) and
 * from the refocus spec (useTerminalSocket.refocus.test.ts). The shared
 * FakeWebSocket harness lives in ../test/fakeTerminalSocket.
 *   AC-1 periodic heartbeat ping
 *   AC-2 any inbound message resets liveness (no reap while alive)
 *   AC-3 a silently-dead OPEN socket is reaped + reconnected
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTerminalSocket } from "./useTerminalSocket";
import { WS_HEARTBEAT_INTERVAL_MS } from "./wsHeartbeat";
import {
  FakeWebSocket,
  advance,
  flush,
  installFakeWebSocket,
  pings,
} from "../test/fakeTerminalSocket";

describe("useTerminalSocket — liveness heartbeat", () => {
  let teardown: () => void;
  beforeEach(() => {
    teardown = installFakeWebSocket();
  });
  afterEach(() => {
    teardown();
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
});
