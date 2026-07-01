/*
 * useAutoLaunch.sizesync — RED test for iterate-2026-07-01-terminal-title-wrap-smear.
 *
 * Root cause: the pty is spawned at a hardcoded 120 cols and the client's real
 * (often narrower — half-screen) width reaches the pty only via a throttled,
 * race-prone `resize`. When the auto-launched `claude … --name "<long title>"`
 * command fires before the real width is applied, Claude Code renders its
 * width-sensitive title-pill banner at 120 while xterm's grid is narrower; the
 * wrapping banner auto-wraps one extra row and the title's first char collides
 * onto the `>` prompt row ("Der" → "D er").
 *
 * Contract under test: BEFORE the launch command data-frame is written, a size
 * sync (`onBeforeDispatch`) must run so the pty is at the client's real cols
 * when Claude starts. Both the auto-inject path and the manual-send (second
 * launch) path must honour it.
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

import { useAutoLaunch } from "./useAutoLaunch";
import type { UseAutoLaunchOptions } from "./useAutoLaunch";

const COMMANDS = {
  powershell: 'claude --resume abc --name "Long Title That Wraps"',
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

function makeSocket(overrides: Record<string, unknown> = {}) {
  return {
    ready: true,
    role: "writer",
    shellKind: "pwsh",
    terminalReset: null,
    ptyReused: false,
    send: vi.fn(),
    ...overrides,
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
  return {
    taskId: "t1",
    ...over,
  } as unknown as UseAutoLaunchOptions;
}

describe("useAutoLaunch size-sync before dispatch", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("manual-send calls onBeforeDispatch BEFORE writing the command", () => {
    const order: string[] = [];
    const socket = makeSocket({ ptyReused: true });
    socket.send = vi.fn((msg: { type: string }) => order.push(`send:${msg.type}`));
    const onBeforeDispatch = vi.fn(() => order.push("sync"));
    const coord = makeCoord({
      launchToken: 1,
      commands: COMMANDS,
      expiresAt: Date.now() + 60_000,
    });

    const { result } = renderHook(() =>
      useAutoLaunch(
        opts({ socket, coord, gate: makeGate(true), onBeforeDispatch }),
      ),
    );

    // ptyReused=true arms the one-shot guard, so the pending launch parks
    // behind the manual "Send to terminal" confirm.
    expect(result.current.manualSendCommand).toBe(COMMANDS.powershell);

    act(() => result.current.handleManualSend());

    expect(onBeforeDispatch).toHaveBeenCalledTimes(1);
    expect(socket.send).toHaveBeenCalledWith({
      type: "data",
      payload: COMMANDS.powershell + "\r",
    });
    // Ordering: the size sync must precede the command write.
    expect(order).toEqual(["sync", "send:data"]);
  });

  it("auto-inject calls onBeforeDispatch BEFORE writing the command", async () => {
    const order: string[] = [];
    const socket = makeSocket();
    socket.send = vi.fn((msg: { type: string }) => order.push(`send:${msg.type}`));
    const onBeforeDispatch = vi.fn(() => order.push("sync"));
    // The taskId mount-reset forces dataSeenInitially=false, so the handshake
    // clears via the 1500 ms no-data grace path; advance past it.
    const gate = makeGate(false);
    const coord = makeCoord({
      launchToken: 7,
      commands: COMMANDS,
      expiresAt: Date.now() + 60_000,
    });

    renderHook(() => useAutoLaunch(opts({ socket, coord, gate, onBeforeDispatch })));

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1700);
    });

    expect(onBeforeDispatch).toHaveBeenCalledTimes(1);
    expect(socket.send).toHaveBeenCalledWith({
      type: "data",
      payload: COMMANDS.powershell + "\r",
    });
    expect(order).toEqual(["sync", "send:data"]);
  });
});
