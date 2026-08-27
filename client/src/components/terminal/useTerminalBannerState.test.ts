/*
 * useTerminalBannerState — regression test for doubt-reviewer's MEDIUM
 * finding (third pass, iterate-2026-08-27-terminal-replay-reset-reopen-
 * reconnect): `resetBannerDismissed` had the same "per-task latch, only
 * reset on taskId change" shape as the fifth finding's bug, and this
 * iterate's own Bug-B fix newly makes it reachable — Reopen (done ->
 * non-done) reconnects the socket and can genuinely report a NEW
 * `terminalReset: true`, but an earlier dismissal on the SAME mounted
 * instance silently suppressed the banner explaining it.
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect } from "vitest";
import { useTerminalBannerState } from "./useTerminalBannerState";

describe("useTerminalBannerState — Reopen re-arms a dismissed reset banner", () => {
  it("clears resetBannerDismissed on a done -> non-done taskState transition", () => {
    const { result, rerender } = renderHook(
      (props: { taskId: string; taskState: string }) =>
        useTerminalBannerState(props.taskId, props.taskState),
      { initialProps: { taskId: "t1", taskState: "done" } },
    );

    act(() => {
      result.current.setResetBannerDismissed(true);
    });
    expect(result.current.resetBannerDismissed).toBe(true);

    // Reopen: taskState flips done -> draft, same mounted instance (same
    // taskId — EmbeddedTerminal never remounts across this transition).
    rerender({ taskId: "t1", taskState: "draft" });

    expect(result.current.resetBannerDismissed).toBe(false);
  });

  it("does NOT clear the dismissal on an unrelated taskState change (e.g. draft -> active)", () => {
    const { result, rerender } = renderHook(
      (props: { taskId: string; taskState: string }) =>
        useTerminalBannerState(props.taskId, props.taskState),
      { initialProps: { taskId: "t1", taskState: "draft" } },
    );

    act(() => {
      result.current.setResetBannerDismissed(true);
    });

    rerender({ taskId: "t1", taskState: "active" });

    expect(result.current.resetBannerDismissed).toBe(true);
  });

  it("clears resetBannerDismissed on a launch_failed -> active Retry transition", () => {
    // doubt-reviewer (MEDIUM, 6th pass) — Retry hits the same "same
    // mounted instance, genuinely new terminalReset" shape as Reopen, but
    // via launch_failed instead of done. `sessionEnded` (EmbeddedTerminal)
    // treats the two identically; this hook must too.
    const { result, rerender } = renderHook(
      (props: { taskId: string; taskState: string }) =>
        useTerminalBannerState(props.taskId, props.taskState),
      { initialProps: { taskId: "t1", taskState: "launch_failed" } },
    );

    act(() => {
      result.current.setResetBannerDismissed(true);
    });
    expect(result.current.resetBannerDismissed).toBe(true);

    rerender({ taskId: "t1", taskState: "active" });

    expect(result.current.resetBannerDismissed).toBe(false);
  });

  it("still resets on a taskId change (pre-existing behavior, unaffected)", () => {
    const { result, rerender } = renderHook(
      (props: { taskId: string; taskState: string }) =>
        useTerminalBannerState(props.taskId, props.taskState),
      { initialProps: { taskId: "t1", taskState: "active" } },
    );

    act(() => {
      result.current.setResetBannerDismissed(true);
    });

    rerender({ taskId: "t2", taskState: "active" });

    expect(result.current.resetBannerDismissed).toBe(false);
  });
});
