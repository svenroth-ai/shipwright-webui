/*
 * useReplayDrainGate — replay snapshot width-sync
 * (iterate-2026-06-15-terminal-readonly-reflow).
 *
 * Root cause: the cell-state snapshot is serialized at the WRITER's width
 * (live-mirror cols, ADR-087/088). A read-only reader whose terminal was fit
 * to a narrower viewport wrote that wider snapshot into the narrow terminal →
 * @xterm/addon-serialize's absolute cursor moves clamped at the wrong column →
 * character interleaving ("Dein vom" → "De invom"). The gate must size the
 * terminal to the snapshot's dims BEFORE writing it.
 */

import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useRef } from "react";
import type { Terminal } from "@xterm/xterm";

import { useReplayDrainGate } from "./useReplayDrainGate";

/** Mock Terminal that records the order of resize/write calls. */
function makeTerm(cols: number, rows: number, order: string[]) {
  const term: Record<string, unknown> = {
    cols,
    rows,
    reset: vi.fn(() => order.push("reset")),
    resize: vi.fn((c: number, r: number) => {
      order.push(`resize(${c},${r})`);
      term.cols = c;
      term.rows = r;
    }),
    // write(data, cb?) — invoke the completion callback synchronously.
    write: vi.fn((_data: string, cb?: () => void) => {
      order.push("write");
      cb?.();
    }),
    scrollToBottom: vi.fn(),
    refresh: vi.fn(),
  };
  return term as unknown as Terminal;
}

function mountGate(term: Terminal) {
  return renderHook(() => {
    const termRef = useRef<Terminal | null>(term);
    const disposedRef = useRef(false);
    return useReplayDrainGate(termRef, disposedRef);
  });
}

const SNAP = (over: Partial<{ data: string; cols: number; rows: number; terminalVersion: string }> = {}) => ({
  data: "snapshot-bytes",
  cols: 120,
  rows: 30,
  terminalVersion: "6.0.0",
  ...over,
});

describe("useReplayDrainGate — snapshot width-sync (read-only narrow replay)", () => {
  it("resizes the terminal to the snapshot dims BEFORE writing when they differ", () => {
    const order: string[] = [];
    const term = makeTerm(40, 24, order); // reader fit to a narrow phone width
    const { result } = mountGate(term);

    result.current.onReplaySnapshot(SNAP({ cols: 120, rows: 30 }));

    expect(term.resize).toHaveBeenCalledWith(120, 30);
    // The resize MUST precede the write (else the snapshot reconstructs at 40).
    const resizeIdx = order.indexOf("resize(120,30)");
    const writeIdx = order.indexOf("write");
    expect(resizeIdx).toBeGreaterThanOrEqual(0);
    expect(writeIdx).toBeGreaterThan(resizeIdx);
  });

  it("does NOT resize when the terminal already matches the snapshot dims", () => {
    const order: string[] = [];
    const term = makeTerm(120, 30, order); // writer / already-correct width
    const { result } = mountGate(term);

    result.current.onReplaySnapshot(SNAP({ cols: 120, rows: 30 }));

    expect(term.resize).not.toHaveBeenCalled();
    expect(term.write).toHaveBeenCalledWith("snapshot-bytes", expect.any(Function));
  });

  it("ignores non-positive snapshot dims (defensive — never resize to 0)", () => {
    const order: string[] = [];
    const term = makeTerm(80, 24, order);
    const { result } = mountGate(term);

    result.current.onReplaySnapshot(SNAP({ cols: 0, rows: 0 }));

    expect(term.resize).not.toHaveBeenCalled();
    expect(term.write).toHaveBeenCalled();
  });
});
