/*
 * useTerminalShellEffects — RECONNECTING-BANNER GRACE (AC-5)
 * (iterate-2026-07-21-mac-sleep-terminal-frozen).
 *
 * The banner must tell the user about a real outage without flickering on every
 * momentary blip: a server restart or a brief partition is recovered inside the
 * fast reconnect ramp, well under the grace window.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { useState } from "react";

import { useTerminalShellEffects } from "./useTerminalShellEffects";
import { attachWsLiveness, type WsLivenessController } from "../../hooks/wsLiveness";
import { WS_INTERACTION_STALE_MS } from "../../hooks/wsHeartbeat";
import type { UseTerminalSocketResult } from "../../hooks/useTerminalSocket";

const GRACE_MS = 1500;

function render(reconnecting: boolean, setArmed: (v: boolean) => void) {
  return renderHook(
    ({ rc }: { rc: boolean }) =>
      useTerminalShellEffects({
        socket: {
          ready: false,
          role: null,
          reconnecting: rc,
        } as unknown as UseTerminalSocketResult,
        active: false,
        termRef: { current: null },
        fitAddonRef: { current: null },
        disposedRef: { current: false },
        setReadOnlyArmed: () => {},
        setReconnectingArmed: setArmed as never,
      }),
    { initialProps: { rc: reconnecting } },
  );
}

describe("useTerminalShellEffects — reconnecting banner grace", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("does NOT arm before the grace elapses — a brief blip must not flash", async () => {
    const calls: boolean[] = [];
    render(true, (v) => calls.push(v));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GRACE_MS - 100);
    });
    expect(calls).not.toContain(true);
  });

  it("arms once the outage outlives the grace", async () => {
    const calls: boolean[] = [];
    render(true, (v) => calls.push(v));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GRACE_MS + 50);
    });
    expect(calls).toContain(true);
  });

  it("disarms immediately when the socket comes back — self-dismissing banner", async () => {
    const calls: boolean[] = [];
    const { rerender } = render(true, (v) => calls.push(v));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GRACE_MS + 50);
    });
    expect(calls).toContain(true);
    calls.length = 0;
    // Socket recovered.
    await act(async () => {
      rerender({ rc: false });
    });
    expect(calls).toContain(false);
    expect(calls).not.toContain(true);
  });

  it("a blip that recovers inside the grace never arms the banner at all", async () => {
    const calls: boolean[] = [];
    const { rerender } = render(true, (v) => calls.push(v));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GRACE_MS - 200);
      rerender({ rc: false });
    });
    // Let the ORIGINAL grace deadline pass — its timer must have been cleared.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GRACE_MS * 2);
    });
    expect(calls).not.toContain(true);
  });
});

/*
 * Composed with wsLiveness's real onProbing source (doubt-review MEDIUM,
 * iterate-2026-09-06-tablet-ipad-ux-pass). The synthetic-boolean tests above
 * already prove the grace gate is source-agnostic; this drives the ACTUAL
 * probe timer from `attachWsLiveness` through to `setReconnectingArmed`,
 * because the doubt was specifically that no test connects those two real
 * contracts end to end.
 *
 * The trade-off this proves is real and accepted, not hidden: before this
 * iterate, `reconnecting` only ever went true after an actual socket CLOSE.
 * Now it also goes true the instant an eager liveness probe is SENT — so a
 * probe that resolves in the open (1500ms, 4000ms) band (an otherwise-healthy
 * connection that was merely slow to pong — plausible on the exact flaky
 * iPad networks this iterate targets) now visibly arms the banner for a
 * bounded window, where before it was silent. The existing grace timer
 * (comment above, `RECONNECTING_BANNER_GRACE_MS`) already encodes the
 * governing rule for this trade-off: "only an outage that outlives the grace
 * is worth telling the user about" — this fix does not invent a new
 * threshold, it feeds a new signal through the SAME one. The alternative
 * (staying silent until the socket outright closes) would leave exactly the
 * slow-but-recovering population this iterate exists to fix unsignalled,
 * silently reintroducing the "frozen frame, no indication anything is
 * happening" bug for that band.
 */
describe("useTerminalShellEffects — reconnecting banner grace, composed with wsLiveness onProbing", () => {
  const OPEN = 1;
  function fakeSocket() {
    return { readyState: OPEN, sent: [] as string[], send(d: string) { this.sent.push(d); }, close: vi.fn() };
  }

  function renderComposed() {
    const socketRef = { current: fakeSocket() };
    let controller: WsLivenessController | null = null;
    const armedCalls: boolean[] = [];
    // Stable identity across renders — an inline arrow here would change on
    // every render and re-fire the grace-timer effect's cleanup/re-arm each
    // time (its deps array includes this callback), corrupting the very
    // timing this test exists to pin.
    // useTerminalShellEffects only ever calls this with a literal boolean
    // (never an updater function), so a plain-boolean signature is accurate
    // to the real call sites; cast at the call boundary below.
    const setReconnectingArmed = (v: boolean) => { armedCalls.push(v); };
    const hook = renderHook(() => {
      const [reconnecting, setReconnecting] = useState(false);
      if (!controller) {
        controller = attachWsLiveness({
          getSocket: () => socketRef.current,
          openState: OPEN,
          isReplayOnly: () => false,
          isCancelled: () => false,
          rearmBudget: vi.fn(),
          reconnect: vi.fn(),
          onProbing: setReconnecting,
        });
      }
      useTerminalShellEffects({
        socket: { ready: false, role: null, reconnecting } as unknown as UseTerminalSocketResult,
        active: false,
        termRef: { current: null },
        fitAddonRef: { current: null },
        disposedRef: { current: false },
        setReadOnlyArmed: () => {},
        setReconnectingArmed: setReconnectingArmed as never,
      });
      return { reconnecting };
    });
    return {
      socketRef,
      armedCalls,
      hook,
      pong: () => controller!.noteInbound(),
      // Simulate the user returning after the socket has been inbound-silent
      // long enough to be suspect — the exact "tap back into the terminal"
      // trigger this whole iterate is about (wsLiveness.interaction.test.ts
      // covers the gating itself; this composition starts from an already-
      // stale attach so a single keydown reliably fires the probe).
      wake: async () => {
        await vi.advanceTimersByTimeAsync(WS_INTERACTION_STALE_MS + 1_000);
        document.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true }));
      },
    };
  }

  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("a probe answered in 800ms (well under grace) never arms the banner", async () => {
    const { armedCalls, pong, wake } = renderComposed();
    await act(async () => {
      await wake(); // probe sent, onProbing(true) -> reconnecting=true
      await vi.advanceTimersByTimeAsync(800);
    });
    // pong() flushed in its own act() boundary — a state update from a plain
    // function call (not an RTL rerender) needs its own act() to guarantee
    // the effect cleanup (clearTimeout on the pending grace timer) commits
    // before the next timer advance, rather than racing it.
    await act(async () => {
      pong();
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(GRACE_MS + 200); // let any pending grace timer resolve
    });
    expect(armedCalls).not.toContain(true);
  });

  it("a probe answered at 2500ms after it started (past the grace, inside the 4s probe deadline) arms then self-disarms — bounded, not stuck", async () => {
    const { armedCalls, pong, wake } = renderComposed();
    await act(async () => {
      await wake(); // probe sent, onProbing(true) -> reconnecting=true
      await vi.advanceTimersByTimeAsync(GRACE_MS + 200); // outlived the grace
    });
    expect(armedCalls).toContain(true); // banner IS visible — the accepted trade-off
    armedCalls.length = 0;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2500 - (GRACE_MS + 200)); // reach t=2500ms since probe start
    });
    // pong() flushed in its own act() boundary — see the sibling test above.
    await act(async () => {
      pong();
    });
    expect(armedCalls).toContain(false); // self-dismisses the instant the pong lands
  });
});
