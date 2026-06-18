/*
 * useTerminalSocket — RECONNECT-ON-REFOCUS behaviour
 * (iterate-2026-06-18-terminal-ws-reconnect-refocus).
 *
 * Sibling of useTerminalSocket.heartbeat.test.ts; shares the FakeWebSocket
 * harness in ../test/fakeTerminalSocket.
 *   AC-4  focus / pageshow / visibilitychange each re-arm an exhausted budget
 *   AC-4d a refocus while CONNECTING does NOT double-connect (orphan guard)
 *   AC-5  an eager refocus probe closes an OPEN-but-dead socket
 *   AC-5b a probe does NOT close a socket that answers in time
 *   AC-5c a stale probe does NOT close a healthy reconnected socket
 *   AC-6  a replay-only (done) attach is NEVER reconnected on refocus
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTerminalSocket } from "./useTerminalSocket";
import { WS_REFOCUS_PROBE_MS } from "./wsHeartbeat";
import {
  FakeWebSocket,
  advance,
  exhaustBudget,
  flush,
  installFakeWebSocket,
  pings,
} from "../test/fakeTerminalSocket";

describe("useTerminalSocket — reconnect-on-refocus", () => {
  let teardown: () => void;
  beforeEach(() => {
    teardown = installFakeWebSocket();
  });
  afterEach(() => {
    teardown();
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
