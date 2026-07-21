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

import { useTerminalShellEffects } from "./useTerminalShellEffects";
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
