/*
 * useTerminalSocket — OS-RESUME RECOVERY (iterate-2026-07-21-mac-sleep-terminal-frozen).
 *
 * REPRODUCTION of the reported defect: "leave the Mac, it sleeps, come back and
 * the embedded terminal is frozen — I cannot scroll — and I have to refresh the
 * browser tab" (Edge/macOS, lid-close → password lock screen, WebUI reached
 * over Tailscale to the Windows host).
 *
 * The distinguishing fact from the reporter: it DOES self-heal, but only after
 * ~30 s. So the reconnect machinery is not absent — it is spent too early.
 *
 * Timeline the specs below pin:
 *   t=0     lid opens, lock screen clears, Edge regains focus → `focus` fires.
 *           The socket still reports OPEN (a half-open TCP connection that
 *           slept through; no `close` was ever delivered).
 *   t=0     wsLiveness re-arms the budget and eagerly probes with a ping.
 *   t=4s    WS_REFOCUS_PROBE_MS elapses unanswered → close → reconnect cascade.
 *   t=4-10s the 5-attempt / ~6.2 s budget is spent against a network that
 *           CANNOT answer yet — Tailscale needs appreciably longer than 6.2 s
 *           to re-establish after an OS resume.
 *   t=15s   Tailscale is up. Nothing retries: `scheduleReconnect` returns early
 *           forever, and the heartbeat was stopped on disconnect. The client is
 *           completely inert until some LATER lifecycle event happens to arrive.
 *
 * That last step is the defect: recovery is left to luck rather than to a timer.
 * "Scrolling is dead" is the same root cause, not a second one — in Claude's TUI
 * (alt-screen) a scroll is not local, it is forwarded to the pty over this very
 * socket (touch-scroll.ts routeScroll), so a dead socket silently eats it.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useTerminalSocket } from "./useTerminalSocket";
import {
  WS_CONNECT_TIMEOUT_MS,
  WS_RECONNECT_TAIL_MS,
  WS_REFOCUS_PROBE_MS,
} from "./wsHeartbeat";
import {
  FakeWebSocket,
  advance,
  flush,
  installFakeWebSocket,
  pings,
} from "../test/fakeTerminalSocket";

/** Drive one live+ready writer attach. */
async function connectReady() {
  const hook = renderHook(() => useTerminalSocket({ taskId: "t1" }));
  await flush();
  await act(async () => {
    FakeWebSocket.last.__message(
      JSON.stringify({ type: "ready", role: "writer", shellKind: "posix", cwd: "/x" }),
    );
  });
  return hook;
}

/**
 * Replay the OS-resume sequence with the network still down, and return the
 * socket count once the reconnect budget is spent.
 */
async function resumeIntoDownNetwork(): Promise<number> {
  // Every connect attempt fails: Tailscale has not finished re-establishing.
  FakeWebSocket.nextMode = "fail";
  // Lock screen clears → Edge regains focus.
  await act(async () => {
    window.dispatchEvent(new Event("focus"));
  });
  // Eager probe goes unanswered → close → the 5-attempt cascade runs.
  await advance(WS_REFOCUS_PROBE_MS + 50);
  await advance(10_000);
  return FakeWebSocket.instances.length;
}

describe("useTerminalSocket — recovery after an OS sleep/resume", () => {
  let teardown: () => void;
  beforeEach(() => {
    teardown = installFakeWebSocket();
  });
  afterEach(() => {
    teardown();
  });

  it("PROBE (control): the refocus probe fires and the budget genuinely spends", async () => {
    await connectReady();
    const ws1 = FakeWebSocket.last;
    const spent = await resumeIntoDownNetwork();
    // The eager probe did ping the half-open socket, and it was reaped.
    expect(pings(ws1).length).toBeGreaterThanOrEqual(1);
    expect(ws1.readyState).toBe(FakeWebSocket.CLOSED);
    // 1 original + 5 failed reconnect attempts.
    expect(spent).toBe(6);
  });

  it("AC-1: after the fast ramp a retry stays armed — the client is never inert", async () => {
    await connectReady();
    const spent = await resumeIntoDownNetwork();
    // THE regression guard. Before the fix this was exactly `0`: with no pending
    // timer nothing was left that could ever notice the network coming back,
    // which is what left the terminal frozen until a refresh.
    expect(vi.getTimerCount()).toBeGreaterThan(0);
    // ...and the armed retry fires on the calm tail cadence (AC-6: one attempt
    // per interval, not a hot loop).
    await advance(WS_RECONNECT_TAIL_MS + 50);
    expect(FakeWebSocket.instances.length).toBe(spent + 1);
  });

  it("REPRO: when the network returns after the budget is spent, the terminal reconnects", async () => {
    const { result } = await connectReady();
    const spent = await resumeIntoDownNetwork();
    expect(result.current.open).toBe(false);

    // Tailscale finishes re-establishing ~15 s after the resume. From here on
    // every connect attempt WOULD succeed.
    FakeWebSocket.nextMode = "open";
    await advance(30_000);

    expect(FakeWebSocket.instances.length).toBeGreaterThan(spent);
    expect(result.current.open).toBe(true);
  });

  /*
   * External code review (openai + gemini, both HIGH) suspected that an
   * out-of-band `online` reconnect leaves the already-armed tail timer running,
   * so it would fire seconds later and open a SECOND socket — a duplicate
   * server attach that steals the writer slot from ourselves.
   *
   * It does not: the `reconnect` dep clears `reconnectTimerRef` before calling
   * connect() (useTerminalSocket.ts). Both reviewers were reading the diff
   * alone, where that pre-existing dep is not visible. This test converts that
   * reading into a standing guarantee.
   */
  it("AC-3 guard: `online` recovery cancels the armed tail — no delayed second attach", async () => {
    await connectReady();
    await resumeIntoDownNetwork();
    FakeWebSocket.nextMode = "open";
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await flush();
    const afterRecovery = FakeWebSocket.instances.length;
    expect(FakeWebSocket.last.readyState).toBe(FakeWebSocket.OPEN);
    // Let the interval the stale tail timer WOULD have fired in elapse twice.
    await advance(WS_RECONNECT_TAIL_MS * 2 + 100);
    expect(FakeWebSocket.instances.length).toBe(afterRecovery);
  });

  it("AC-1: an attempt stuck in CONNECTING is reaped — a hung connect cannot leave the client inert", async () => {
    await connectReady();
    // The tunnel is half-restored: the connect hangs instead of failing, so no
    // `close` fires and nothing would schedule the next retry.
    FakeWebSocket.nextMode = "hang";
    await act(async () => {
      FakeWebSocket.last.__close();
    });
    await advance(1000); // first backoff rung -> a CONNECTING socket
    const hung = FakeWebSocket.last;
    expect(hung.readyState).toBe(FakeWebSocket.CONNECTING);
    const before = FakeWebSocket.instances.length;

    // Without the watchdog this sits in CONNECTING forever with no armed retry.
    FakeWebSocket.nextMode = "open";
    await advance(WS_CONNECT_TIMEOUT_MS + WS_RECONNECT_TAIL_MS + 100);
    expect(hung.readyState).toBe(FakeWebSocket.CLOSED);
    expect(FakeWebSocket.instances.length).toBeGreaterThan(before);
    expect(FakeWebSocket.last.readyState).toBe(FakeWebSocket.OPEN);
  });

  it("AC-3 guard: `online` leaves a healthy OPEN socket alone — no double attach", async () => {
    await connectReady();
    expect(FakeWebSocket.instances).toHaveLength(1);
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await flush();
    // A second socket here would mean two server attaches for one terminal,
    // stealing the writer slot from ourselves.
    expect(FakeWebSocket.instances).toHaveLength(1);
    expect(FakeWebSocket.last.readyState).toBe(FakeWebSocket.OPEN);
  });

  it("AC-5: `reconnecting` is true while down and clears on recovery", async () => {
    const { result } = await connectReady();
    expect(result.current.reconnecting).toBe(false);
    await resumeIntoDownNetwork();
    // Down, but a retry is armed — this is what the banner reads.
    expect(result.current.reconnecting).toBe(true);
    FakeWebSocket.nextMode = "open";
    await advance(WS_RECONNECT_TAIL_MS + 50);
    expect(result.current.open).toBe(true);
    expect(result.current.reconnecting).toBe(false);
  });

  it("AC-5: a replay-only (done) attach never claims to be reconnecting", async () => {
    const { result } = await connectReady();
    await act(async () => {
      FakeWebSocket.last.__message(
        JSON.stringify({
          type: "ready",
          role: "reader",
          shellKind: null,
          cwd: "/x",
          replayOnly: true,
        }),
      );
      FakeWebSocket.last.close(1000);
    });
    // Finished, not broken — the banner must stay silent.
    expect(result.current.reconnecting).toBe(false);
  });

  it("AC-4: a replay-only (done) attach is never resurrected — not by the tail, not by `online`", async () => {
    renderHook(() => useTerminalSocket({ taskId: "t1" }));
    await flush();
    const ws1 = FakeWebSocket.last;
    await act(async () => {
      ws1.__message(
        JSON.stringify({
          type: "ready",
          role: "reader",
          shellKind: null,
          cwd: "/x",
          replayOnly: true,
        }),
      );
    });
    // ABNORMAL close (1006) — deliberately NOT the clean 1000 that the close
    // handler already filters. This is the path an unbounded retry tail would
    // otherwise loop on forever, replaying the snapshot every few seconds.
    await act(async () => {
      ws1.__close();
    });
    FakeWebSocket.nextMode = "open";
    await advance(WS_RECONNECT_TAIL_MS * 4);
    expect(FakeWebSocket.instances).toHaveLength(1);

    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await flush();
    expect(FakeWebSocket.instances).toHaveLength(1);
  });

  it("REPRO: an `online` event after the budget is spent recovers the terminal", async () => {
    const { result } = await connectReady();
    await resumeIntoDownNetwork();
    expect(result.current.open).toBe(false);

    // The browser tells us the network came back. That signal is currently
    // unobserved anywhere in the client.
    FakeWebSocket.nextMode = "open";
    await act(async () => {
      window.dispatchEvent(new Event("online"));
    });
    await flush();

    expect(result.current.open).toBe(true);
  });
});
