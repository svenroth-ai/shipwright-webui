/*
 * useAutoLaunch.reopen-gate-reset — regression tests for doubt-reviewer's
 * MEDIUM finding (fourth pass, iterate-2026-08-27-terminal-replay-reset-
 * reopen-reconnect).
 *
 * The Reopen re-arm effect (done -> non-done) resets the one-shot
 * auto-inject guards, but left the gate's prompt-readiness bookkeeping
 * (`dataSeenInitiallyRef`, `lastPtyDataAtRef`) untouched. A pre-close
 * session leaves `dataSeenInitiallyRef: true` and a stale, ancient
 * `lastPtyDataAtRef`. Reopen's reconnect can spawn a genuinely fresh bare
 * shell (pty reaped while closed) that has emitted zero bytes of its own
 * -- without resetting the gate, the handshake's very FIRST poll reads the
 * stale timestamp as "already quiesced" and dispatches instantly, before
 * the new shell has rendered a prompt.
 *
 * The fix moved (code-reviewer, 7th finding) from the raw taskState edge
 * onto the server-derived `terminalReset === true` signal, since a
 * transient taskState tick can fire with the socket undisturbed. So this
 * test drives: stale data bookkeeping while `done` -> Reopen (taskState
 * flips, no reset yet) -> a fresh reconnect ready (terminalReset:true,
 * ptyReused:false, zero data yet -- gate resets HERE) -> a pending launch
 * -- and asserts the handshake does NOT dispatch instantly; it only fires
 * after the no-data grace elapses (proving the gate was genuinely reset).
 *
 * It also asserts `gate.resetGate()` is never called on this path
 * (doubt-reviewer HIGH, 5th pass): Reopen never remounts xterm, so an OLD
 * `replay_snapshot` write can still be draining on the same terminal, and
 * clobbering the drain queue's own in-flight bookkeeping would let a new
 * snapshot apply immediately instead of parking behind it, corrupting the
 * buffer. Only the two named prompt-readiness refs are reset here.
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { useAutoLaunch } from "./useAutoLaunch";
import type { UseAutoLaunchOptions } from "./useAutoLaunch";

const COMMANDS = {
  powershell: 'claude --resume abc --name "Task"',
  cmd: "claude cmd",
  posix: "claude posix",
} as const;

function makeGate(seenInitially: boolean, lastDataAt: number) {
  return {
    dataSeenInitiallyRef: { current: seenInitially },
    lastPtyDataAtRef: { current: lastDataAt },
    onDataChunk: vi.fn(),
    onReplaySnapshot: vi.fn(),
    resetGate: vi.fn(),
  };
}

function makeCoord(pending: unknown) {
  return {
    pendingLaunch: pending,
    consumeLaunch: vi.fn(),
    cancelLaunch: vi.fn(),
  };
}

function opts(over: Partial<Record<keyof UseAutoLaunchOptions, unknown>>) {
  return { taskId: "t1", ...over } as unknown as UseAutoLaunchOptions;
}

interface TestSocket {
  ready: boolean;
  role: string | null;
  shellKind: string | null;
  terminalReset: boolean;
  ptyReused: boolean;
  replayOnly: boolean | null;
  send: ReturnType<typeof vi.fn>;
}

describe("useAutoLaunch — Reopen resets the gate's stale prompt-readiness bookkeeping", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("does not instantly dispatch onto a fresh reopened shell using a stale lastPtyDataAtRef", async () => {
    const gate = makeGate(false, 0);

    const quietSocket: TestSocket = {
      ready: false,
      role: null,
      shellKind: null,
      terminalReset: false,
      ptyReused: false,
      replayOnly: null,
      send: vi.fn(),
    };
    const { rerender } = renderHook(
      (props: { taskState: string; socket: TestSocket; coord: ReturnType<typeof makeCoord> }) =>
        useAutoLaunch(opts({ ...props, gate })),
      { initialProps: { taskState: "done", socket: quietSocket, coord: makeCoord(null) } },
    );

    // 1. A real, hours-old session: data flowed while live, THEN the task
    //    went `done` (no taskId change, same mounted instance — the mount
    //    effect above already ran and is not what this test is about;
    //    clear it so the assertions below are scoped to the Reopen edge).
    gate.resetGate.mockClear();
    gate.dataSeenInitiallyRef.current = true;
    gate.lastPtyDataAtRef.current = Date.now() - 999_999;

    // 2. Reopen: taskState flips done -> draft. The gate does NOT reset
    //    here (that would fire on an undisturbed transient tick too) —
    //    it waits for the server-derived `terminalReset` signal below.
    rerender({ taskState: "draft", socket: quietSocket, coord: makeCoord(null) });
    expect(gate.dataSeenInitiallyRef.current).toBe(true);
    expect(gate.resetGate).not.toHaveBeenCalled();

    // 3. The reconnect's live ready arrives: a fresh bare shell, zero bytes
    //    emitted yet. `terminalReset: true` is what actually resets the
    //    gate's prompt-readiness bookkeeping.
    const liveSocket: TestSocket = {
      ready: true,
      role: "writer",
      shellKind: "pwsh",
      terminalReset: true,
      ptyReused: false,
      replayOnly: false,
      send: vi.fn(),
    };
    const coord = makeCoord({
      launchToken: 1,
      commands: COMMANDS,
      expiresAt: Date.now() + 60_000,
    });
    rerender({ taskState: "draft", socket: liveSocket, coord });

    // Fix under test: the gate's prompt-readiness bookkeeping is now
    // reset, not stale — but `resetGate()` itself must NOT be called
    // (doubt-reviewer HIGH, 5th pass): it would clobber the drain queue's
    // own in-flight bookkeeping, defeating the mid-write park protection
    // for an old, still-draining `replay_snapshot` write on this same,
    // never-remounted terminal.
    expect(gate.dataSeenInitiallyRef.current).toBe(false);
    expect(gate.lastPtyDataAtRef.current).toBe(0);
    expect(gate.resetGate).not.toHaveBeenCalled();

    // Immediately (before the 1500 ms no-data grace) — must NOT have fired.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(liveSocket.send).not.toHaveBeenCalled();

    // After the no-data grace elapses, the handshake correctly clears.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1600);
    });
    expect(liveSocket.send).toHaveBeenCalledWith({
      type: "data",
      payload: COMMANDS.powershell + "\r",
    });
  });

  it("resets prompt-readiness bookkeeping on a taskId change without calling gate.resetGate", () => {
    // code-reviewer (HIGH, re-verifying the 9th finding): `EmbeddedTerminal`
    // is not keyed by taskId, so navigating task A -> task B does NOT
    // remount xterm; task A's replay_snapshot write can still be draining
    // when task B's own reset effect runs, so the taskId-change effect
    // must NOT call `gate.resetGate()` either — same rule as terminalReset.
    const gate = makeGate(false, 0);
    const quietSocket: TestSocket = {
      ready: false,
      role: null,
      shellKind: null,
      terminalReset: false,
      ptyReused: false,
      replayOnly: null,
      send: vi.fn(),
    };
    const { rerender } = renderHook(
      (props: { taskId: string }) =>
        useAutoLaunch(opts({ ...props, socket: quietSocket, coord: makeCoord(null), gate })),
      { initialProps: { taskId: "t1" } },
    );
    gate.resetGate.mockClear();
    gate.dataSeenInitiallyRef.current = true;
    gate.lastPtyDataAtRef.current = Date.now() - 999_999;

    rerender({ taskId: "t2" });

    expect(gate.dataSeenInitiallyRef.current).toBe(false);
    expect(gate.lastPtyDataAtRef.current).toBe(0);
    expect(gate.resetGate).not.toHaveBeenCalled();
  });
});
