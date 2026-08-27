/*
 * useReplayDrainGate — mid-write in-flight race (doubt-reviewer MEDIUM,
 * 6th pass, 12th finding, iterate-2026-08-27-terminal-replay-reset-reopen-
 * reconnect).
 *
 * Findings 9 and 11 fixed useAutoLaunch.ts's terminalReset/taskId reset
 * effects to NOT call gate.resetGate() while an old replay_snapshot write
 * could still be draining on the same, never-remounted terminal -- but
 * every existing regression test for those fixes only asserted the mock
 * function `resetGate` was never CALLED, not that the actual protection
 * (parking a new snapshot behind an in-flight old write) still works. This
 * exercises the real, un-mocked useReplayDrainGate against a
 * deferred-callback Terminal double to prove the mechanism holds, and that
 * the old (pre-fix) shape genuinely breaks it.
 */

import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useRef } from "react";
import type { Terminal } from "@xterm/xterm";

import { useReplayDrainGate } from "./useReplayDrainGate";

/** Terminal double whose `write` never completes until explicitly settled. */
function makeDeferredTerm(order: string[]) {
  const pendingCallbacks: Array<() => void> = [];
  const term: Record<string, unknown> = {
    cols: 120,
    rows: 30,
    reset: vi.fn(() => order.push("reset")),
    resize: vi.fn(),
    write: vi.fn((data: string, cb?: () => void) => {
      order.push(`write:${data}`);
      if (cb) pendingCallbacks.push(cb);
    }),
    scrollToBottom: vi.fn(),
    refresh: vi.fn(),
  };
  return {
    term: term as unknown as Terminal,
    settleOldestWrite: () => pendingCallbacks.shift()?.(),
  };
}

const SNAP = (data: string) => ({ data, cols: 120, rows: 30, terminalVersion: "6.0.0" });

function mountGate(term: Terminal) {
  return renderHook(() => {
    const termRef = useRef<Terminal | null>(term);
    const disposedRef = useRef(false);
    return useReplayDrainGate(termRef, disposedRef);
  });
}

describe("useReplayDrainGate — mid-write in-flight race", () => {
  it("parks a new snapshot arriving while an old write is still draining, and applies it cleanly once the old write settles", () => {
    const order: string[] = [];
    const { term, settleOldestWrite } = makeDeferredTerm(order);
    const { result } = mountGate(term);

    // Old snapshot write starts -- deliberately never completes synchronously.
    result.current.onReplaySnapshot(SNAP("OLD"));
    expect(order).toEqual(["reset", "write:OLD"]);

    // A new snapshot arrives while OLD is still "parsing" -- must PARK
    // (no second reset/write yet), not apply immediately.
    result.current.onReplaySnapshot(SNAP("NEW"));
    expect(order).toEqual(["reset", "write:OLD"]);

    // OLD's write settles -- the parked NEW snapshot applies cleanly and
    // in order, never interleaved with OLD's.
    settleOldestWrite();
    expect(order).toEqual(["reset", "write:OLD", "reset", "write:NEW"]);
  });

  it("regression guard: calling resetGate() during the in-flight window reintroduces the corruption findings 9/11 closed", () => {
    // This is what useAutoLaunch.ts's terminalReset/taskId effects used to
    // do pre-fix. Proves those fixes closed a real hole in the REAL gate,
    // not a theoretical one -- a stray external resetGate() mid-write
    // makes NEW apply immediately instead of parking behind OLD.
    const order: string[] = [];
    const { term, settleOldestWrite } = makeDeferredTerm(order);
    const { result } = mountGate(term);

    result.current.onReplaySnapshot(SNAP("OLD"));
    expect(order).toEqual(["reset", "write:OLD"]);

    // The bug: something external clears the in-flight bookkeeping while
    // OLD's write is still draining.
    result.current.resetGate();

    // NEW now applies IMMEDIATELY instead of parking, because resetGate()
    // wrongly cleared `replaySnapshotInFlightRef`.
    result.current.onReplaySnapshot(SNAP("NEW"));
    expect(order).toEqual(["reset", "write:OLD", "reset", "write:NEW"]);

    // OLD's own (still-pending) callback fires late, onto a generation the
    // gate has already moved past -- the generation check makes it a
    // no-op rather than a second, corrective settle.
    settleOldestWrite();
    expect(order).toEqual(["reset", "write:OLD", "reset", "write:NEW"]);
  });
});
