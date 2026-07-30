/*
 * useReplayDrainGate.overflow.test.tsx — the drain queue must not lose output
 * SILENTLY (iterate-2026-07-30-terminal-ws-drop-resync, AC-6).
 *
 * While a `replay_snapshot` write is in flight, live `data` is queued rather than
 * written (interleaving the two corrupts the buffer — the Bug B smear). Past an
 * 8 MiB cap the queue discards its OLDEST chunks, which is exactly what DO-NOT #18
 * forbids ("replay NEVER drops chunks") and is the same defect class as the server's
 * saturation drop: the bytes are gone, and Claude's differential CUF-skipping
 * repaints leave stale characters on the hole forever.
 *
 * The trim itself STAYS — force-draining mid-flight provably re-creates the smear —
 * but it must now announce itself so the caller can request a full-grid resync, the
 * only thing that can restore bytes this terminal never received.
 */

import { renderHook, act } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useRef } from "react";
import type { Terminal } from "@xterm/xterm";

import {
  useReplayDrainGate,
  REPLAY_DRAIN_MAX_BYTES,
} from "./useReplayDrainGate";

/** Terminal whose snapshot write never completes, so the gate stays in flight. */
function makeStuckTerm() {
  return {
    cols: 120,
    rows: 30,
    reset: vi.fn(),
    resize: vi.fn(),
    write: vi.fn((_d: string, _cb?: () => void) => {
      /* never invoke cb — hold the gate open */
    }),
    scrollToBottom: vi.fn(),
    refresh: vi.fn(),
  } as unknown as Terminal;
}

function mountGate(term: Terminal, onQueueOverflow?: () => void) {
  return renderHook(() =>
    useReplayDrainGate(
      useRef<Terminal | null>(term),
      useRef(false),
      undefined,
      onQueueOverflow,
    ),
  );
}

const SNAP = {
  data: "snapshot-bytes",
  cols: 120,
  rows: 30,
  terminalVersion: "6.0.0",
};

describe("useReplayDrainGate — queue overflow announces the loss", () => {
  it("does NOT fire while the queue stays under the cap", () => {
    const onQueueOverflow = vi.fn();
    const gate = mountGate(makeStuckTerm(), onQueueOverflow);
    act(() => gate.result.current.onReplaySnapshot(SNAP));
    act(() => {
      for (let i = 0; i < 8; i++) gate.result.current.onDataChunk("x".repeat(1024));
    });
    expect(onQueueOverflow).not.toHaveBeenCalled();
  });

  it("fires once the cap forces the oldest chunks out", () => {
    const onQueueOverflow = vi.fn();
    const gate = mountGate(makeStuckTerm(), onQueueOverflow);
    act(() => gate.result.current.onReplaySnapshot(SNAP));
    // Push past the cap in big chunks so the trim loop has to shift.
    const chunk = "y".repeat(1024 * 1024);
    act(() => {
      for (let i = 0; i < 10; i++) gate.result.current.onDataChunk(chunk);
    });
    expect(onQueueOverflow).toHaveBeenCalled();
  });

  it("keeps the newest chunk after a trim (never force-drains mid-flight)", () => {
    const term = makeStuckTerm();
    const gate = mountGate(term, vi.fn());
    act(() => gate.result.current.onReplaySnapshot(SNAP));
    const chunk = "z".repeat(1024 * 1024);
    act(() => {
      for (let i = 0; i < 10; i++) gate.result.current.onDataChunk(chunk);
    });
    // The snapshot write is the ONLY write: queued data must not have been
    // flushed into the terminal mid-flight.
    expect((term.write as unknown as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(1);
  });

  it("is optional — omitting the callback must not throw", () => {
    const gate = mountGate(makeStuckTerm());
    act(() => gate.result.current.onReplaySnapshot(SNAP));
    const chunk = "w".repeat(1024 * 1024);
    expect(() =>
      act(() => {
        for (let i = 0; i < 10; i++) gate.result.current.onDataChunk(chunk);
      }),
    ).not.toThrow();
  });

  it("exports a cap consistent with the documented 8 MiB budget", () => {
    expect(REPLAY_DRAIN_MAX_BYTES).toBe(8 * 1024 * 1024);
  });
});

/*
 * External review, medium: the overflow-triggered resync can only ever arrive while
 * a snapshot write IS in flight (the queue fills for no other reason). `term.reset()`
 * is synchronous, so applying the new snapshot immediately would reset the grid while
 * the earlier write's bytes are still in xterm's own queue — those leftovers would
 * then land on the newer grid. The new snapshot is therefore PARKED until the
 * in-flight write settles.
 */
describe("useReplayDrainGate — a snapshot arriving mid-write is parked", () => {
  /** Terminal that hands the test control of each write's completion callback. */
  function makeControllableTerm() {
    const cbs: Array<(() => void) | undefined> = [];
    const writes: string[] = [];
    const term = {
      cols: 120,
      rows: 30,
      reset: vi.fn(),
      resize: vi.fn(),
      write: vi.fn((d: string, cb?: () => void) => {
        writes.push(d);
        cbs.push(cb);
      }),
      scrollToBottom: vi.fn(),
      refresh: vi.fn(),
    };
    return { term: term as unknown as Terminal, raw: term, cbs, writes };
  }

  const SNAP_A = { data: "AAA", cols: 120, rows: 30, terminalVersion: "6.0.0" };
  const SNAP_B = { data: "BBB", cols: 120, rows: 30, terminalVersion: "6.0.0" };
  const SNAP_C = { data: "CCC", cols: 120, rows: 30, terminalVersion: "6.0.0" };

  it("does not reset or write the second snapshot until the first write settles", () => {
    const h = makeControllableTerm();
    const gate = mountGate(h.term);

    act(() => gate.result.current.onReplaySnapshot(SNAP_A));
    expect(h.raw.reset).toHaveBeenCalledTimes(1);
    expect(h.writes).toEqual(["AAA"]);

    // Second snapshot lands BEFORE the first write's callback fires.
    act(() => gate.result.current.onReplaySnapshot(SNAP_B));
    expect(h.raw.reset).toHaveBeenCalledTimes(1); // still parked
    expect(h.writes).toEqual(["AAA"]);

    // Now settle the first write — the parked snapshot applies.
    act(() => h.cbs[0]?.());
    expect(h.raw.reset).toHaveBeenCalledTimes(2);
    expect(h.writes).toEqual(["AAA", "BBB"]);
  });

  /*
   * The hazard the parking exists to prevent, asserted on the WRITE ORDER rather
   * than inferred: superseded deltas must never be written, because `term.reset()`
   * is synchronous and xterm would parse those just-pushed bytes onto the grid the
   * snapshot is about to paint. `serializeStable` emits no `ESC[2J`, so the payload
   * only overwrites the cells it touches and the leftovers survive as stale chars.
   */
  it("never writes deltas superseded by a parked snapshot", () => {
    const h = makeControllableTerm();
    const gate = mountGate(h.term);

    act(() => gate.result.current.onReplaySnapshot(SNAP_A));
    act(() => gate.result.current.onDataChunk("SUPERSEDED"));
    act(() => gate.result.current.onReplaySnapshot(SNAP_B));
    act(() => gate.result.current.onDataChunk("AFTER-B"));
    act(() => h.cbs[0]?.());

    // SNAP_B must land WITHOUT the pre-B delta ever being written.
    expect(h.writes).toEqual(["AAA", "BBB"]);

    // ...and the post-B delta survives, drained once SNAP_B settles. Losing it
    // would be the very data loss this iterate removes.
    act(() => h.cbs[1]?.());
    expect(h.writes).toEqual(["AAA", "BBB", "AFTER-B"]);
  });

  it("discards a parked snapshot on resetGate — it belongs to the old task", () => {
    const h = makeControllableTerm();
    const gate = mountGate(h.term);

    act(() => gate.result.current.onReplaySnapshot(SNAP_A));
    act(() => gate.result.current.onReplaySnapshot(SNAP_B));
    act(() => gate.result.current.resetGate());
    // The stale callback is neutralised by the generation bump; the parked grid must
    // NOT be restored later, or a previous task's screen reappears and gets smeared.
    act(() => h.cbs[0]?.());
    expect(h.writes).toEqual(["AAA"]);
  });

  it("keeps only the LATEST parked snapshot", () => {
    const h = makeControllableTerm();
    const gate = mountGate(h.term);

    act(() => gate.result.current.onReplaySnapshot(SNAP_A));
    act(() => gate.result.current.onReplaySnapshot(SNAP_B));
    act(() => gate.result.current.onReplaySnapshot(SNAP_C));
    act(() => h.cbs[0]?.());

    // B was superseded by C and must never be written.
    expect(h.writes).toEqual(["AAA", "CCC"]);
  });

  it("fires onReplaySettled only after the LAST snapshot settles", () => {
    const h = makeControllableTerm();
    const onReplaySettled = vi.fn();
    const gate = renderHook(() =>
      useReplayDrainGate(
        useRef<Terminal | null>(h.term),
        useRef(false),
        onReplaySettled,
        vi.fn(),
      ),
    );

    act(() => gate.result.current.onReplaySnapshot(SNAP_A));
    act(() => gate.result.current.onReplaySnapshot(SNAP_B));
    act(() => h.cbs[0]?.());
    // The parked snapshot is now in flight — convergence must NOT have run yet, or
    // it would resize/redraw against a grid that is about to be replaced.
    expect(onReplaySettled).not.toHaveBeenCalled();

    act(() => h.cbs[1]?.());
    expect(onReplaySettled).toHaveBeenCalledTimes(1);
  });
});
