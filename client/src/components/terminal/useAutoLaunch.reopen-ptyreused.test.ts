/*
 * useAutoLaunch.reopen-ptyreused — regression test for doubt-reviewer's
 * HIGH finding (iterate-2026-08-27-terminal-replay-reset-reopen-reconnect).
 *
 * A `done` task's FIRST attach is always the server's replay-only branch,
 * which hardcodes `ptyReused: false` (it never inspects the real pty) --
 * that fabricated value permanently latched `ptyReusedGuardEvaluatedRef`
 * before this iterate's Reopen-reconnect fix (Bug B) ever produced a live
 * attach to ask. Left latched, Reopen's reconnect delivering the REAL
 * `ptyReused: true` (the common case -- the old pty usually survives the
 * close, per IdleReaper's 12h grace) was silently dropped, so the one-shot
 * auto-inject guard stayed unarmed and a post-Reopen Resume would have
 * auto-injected `claude --resume` straight into what may still be a live
 * Claude TUI -- exactly what this guard exists to prevent.
 *
 * Test 1 drives the real sequence through ONE hook instance: replay-only
 * ready (ptyReused:false) -> Reopen (taskState done -> draft) -> reconnect
 * ready (ptyReused:true) -> a pending launch -- and asserts it parks behind
 * manual "Send to terminal" (does NOT auto-inject).
 *
 * Test 2 covers spec-reviewer's REJECT of the first fix attempt (a one-shot
 * reset alone): the AC-7 race where Reopen fires BEFORE the original done
 * attach's replay-only ready has even arrived, so that stale, fabricated
 * ready lands AFTER the reset -- and must still not consume the guard slot
 * meant for the real reconnect ready that follows it.
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";

import { useAutoLaunch } from "./useAutoLaunch";
import type { UseAutoLaunchOptions } from "./useAutoLaunch";

const COMMANDS = {
  powershell: 'claude --resume abc --name "Task"',
  cmd: "claude cmd",
  posix: "claude posix",
} as const;

function makeGate(seen: boolean) {
  return {
    dataSeenInitiallyRef: { current: seen },
    lastPtyDataAtRef: { current: 0 },
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
  return { taskId: "t1", gate: makeGate(true), ...over } as unknown as UseAutoLaunchOptions;
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

describe("useAutoLaunch — Reopen re-arms the reused-pty guard from a fresh ready", () => {
  it("parks behind manual-send once the reconnect's real ptyReused:true is evaluated (not auto-inject)", () => {
    // 1. The done task's replay-only attach: ptyReused hardcoded false.
    //    Latches `ptyReusedGuardEvaluatedRef` off that fabricated value.
    const replayOnlySocket: TestSocket = {
      ready: true,
      role: "reader",
      shellKind: null,
      terminalReset: false,
      ptyReused: false,
      replayOnly: true,
      send: vi.fn(),
    };
    const { result, rerender } = renderHook(
      (props: { taskState: string; socket: TestSocket; coord: ReturnType<typeof makeCoord> }) =>
        useAutoLaunch(opts(props)),
      {
        initialProps: {
          taskState: "done",
          socket: replayOnlySocket,
          coord: makeCoord(null),
        },
      },
    );

    // 2. Reopen: taskState flips done -> draft. Socket goes quiet during
    //    the reconnect (mirrors resetSessionState()).
    rerender({
      taskState: "draft",
      socket: { ...replayOnlySocket, ready: false, role: null, shellKind: null },
      coord: makeCoord(null),
    });

    // 3. The reconnect's live `ready` arrives with the REAL ptyReused, and
    //    a launch becomes pending (e.g. Resume clicked).
    const liveSocket: TestSocket = {
      ready: true,
      role: "writer",
      shellKind: "pwsh",
      terminalReset: false,
      ptyReused: true,
      replayOnly: false,
      send: vi.fn(),
    };
    const coord = makeCoord({
      launchToken: 1,
      commands: COMMANDS,
      expiresAt: Date.now() + 60_000,
    });
    rerender({ taskState: "draft", socket: liveSocket, coord });

    act(() => {});

    // Correctly re-armed: the launch parks behind manual confirm instead
    // of auto-injecting into what may still be a live Claude TUI.
    expect(liveSocket.send).not.toHaveBeenCalled();
    expect(result.current.manualSendCommand).toBe(COMMANDS.powershell);
  });

  it("does not strand a stale ptyReused latch across a launch_failed -> active Retry onto a genuinely fresh pty", async () => {
    // doubt-reviewer (MEDIUM, 6th pass) — `sessionEnded` (EmbeddedTerminal)
    // treats `launch_failed` identically to `done`; the Reopen re-arm must
    // too. Concrete failure without it: a RESUMED pty (ptyReused:true)
    // latches both guard refs; the task then fails and Retry spawns a
    // genuinely fresh pty (ptyReused:false) -- the stale
    // `launchInjectedThisPtyLifetimeRef` would wrongly park the very
    // first launch into that fresh shell behind manual "Send to terminal"
    // instead of auto-injecting it (a UX regression, not a double-inject
    // safety hole -- the dangerous direction is separately guarded).
    const resumedSocket: TestSocket = {
      ready: true,
      role: "writer",
      shellKind: "pwsh",
      terminalReset: false,
      ptyReused: true,
      replayOnly: false,
      send: vi.fn(),
    };
    const { result, rerender } = renderHook(
      (props: { taskState: string; socket: TestSocket; coord: ReturnType<typeof makeCoord> }) =>
        useAutoLaunch(opts(props)),
      { initialProps: { taskState: "active", socket: resumedSocket, coord: makeCoord(null) } },
    );

    // Task fails; socket tears down.
    rerender({
      taskState: "launch_failed",
      socket: { ...resumedSocket, ready: false, role: null, shellKind: null },
      coord: makeCoord(null),
    });

    // Retry spawns a genuinely fresh pty.
    const freshSocket: TestSocket = {
      ready: true,
      role: "writer",
      shellKind: "pwsh",
      terminalReset: false,
      ptyReused: false,
      replayOnly: false,
      send: vi.fn(),
    };
    const coord = makeCoord({
      launchToken: 1,
      commands: COMMANDS,
      expiresAt: Date.now() + 60_000,
    });
    rerender({ taskState: "active", socket: freshSocket, coord });

    await act(async () => {});

    // Correctly re-armed: auto-injects into the fresh pty instead of
    // parking behind manual confirm.
    expect(freshSocket.send).toHaveBeenCalledWith({
      type: "data",
      payload: COMMANDS.powershell + "\r",
    });
    expect(result.current.manualSendCommand).toBeNull();
  });

  it("survives a STALE replay-only ready landing AFTER Reopen's reset but BEFORE the real reconnect ready (AC-7 race)", () => {
    // 1. Reopen fires (taskState done -> draft) before the done task's
    //    original replay-only attach has even produced its `ready` yet.
    const quietSocket: TestSocket = {
      ready: false,
      role: null,
      shellKind: null,
      terminalReset: false,
      ptyReused: false,
      replayOnly: null,
      send: vi.fn(),
    };
    const { result, rerender } = renderHook(
      (props: { taskState: string; socket: TestSocket; coord: ReturnType<typeof makeCoord> }) =>
        useAutoLaunch(opts(props)),
      {
        initialProps: { taskState: "done", socket: quietSocket, coord: makeCoord(null) },
      },
    );
    rerender({ taskState: "draft", socket: { ...quietSocket, send: vi.fn() }, coord: makeCoord(null) });

    // 2. The now-stale original socket's replay-only ready lands late,
    //    fabricated ptyReused:false. Must NOT consume the fresh guard slot.
    const staleReplayOnlySocket: TestSocket = {
      ready: true,
      role: "reader",
      shellKind: null,
      terminalReset: false,
      ptyReused: false,
      replayOnly: true,
      send: vi.fn(),
    };
    rerender({ taskState: "draft", socket: staleReplayOnlySocket, coord: makeCoord(null) });

    // 3. resetSessionState() quiets the socket before the real reconnect.
    rerender({
      taskState: "draft",
      socket: { ...staleReplayOnlySocket, ready: false, role: null, shellKind: null, replayOnly: null },
      coord: makeCoord(null),
    });

    // 4. The genuine reconnect ready arrives with the real ptyReused:true,
    //    and a launch becomes pending.
    const liveSocket: TestSocket = {
      ready: true,
      role: "writer",
      shellKind: "pwsh",
      terminalReset: false,
      ptyReused: true,
      replayOnly: false,
      send: vi.fn(),
    };
    const coord = makeCoord({
      launchToken: 1,
      commands: COMMANDS,
      expiresAt: Date.now() + 60_000,
    });
    rerender({ taskState: "draft", socket: liveSocket, coord });

    act(() => {});

    expect(liveSocket.send).not.toHaveBeenCalled();
    expect(result.current.manualSendCommand).toBe(COMMANDS.powershell);
  });
});
