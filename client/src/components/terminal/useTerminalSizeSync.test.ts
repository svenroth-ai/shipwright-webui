/*
 * useTerminalSizeSync — pty↔xterm width-sync seam
 * (iterate-2026-07-01-terminal-title-wrap-smear).
 *
 * Direct unit tests for the two behaviours that close the "D er" title-wrap
 * smear:
 *   - syncSizeNow fits + emits a resize (dispatched before the launch command
 *     so the pty is width-correct when Claude renders its title pill).
 *   - onReplaySettled is WRITER-GATED: a writer re-converges (emits a resize)
 *     after a replay settles; a reader does NOT (it keeps the snapshot's
 *     writer width — #150 reader-reflow guard).
 *
 * A fake term without `_core` makes the real `safeFit` fall through to
 * `fit.fit()` and return true (jsdom has no renderer), so the send path runs.
 */

import { renderHook } from "@testing-library/react";
import { describe, it, expect, vi } from "vitest";
import { useRef } from "react";
import type { Terminal } from "@xterm/xterm";
import type { FitAddon } from "@xterm/addon-fit";

import { useTerminalSizeSync } from "./useTerminalSizeSync";
import type { TerminalRole } from "../../hooks/useTerminalSocket";

type ResizeMsg = { type: "resize"; cols: number; rows: number };
/** The redraw nudge carries no dimensions (iterate-2026-07-27). */
type RedrawMsg = { type: "redraw" };
type SentMsg = ResizeMsg | RedrawMsg;

function mount(
  role: TerminalRole | null,
  opts: { term?: Terminal | null; fit?: FitAddon | null; active?: boolean; measurable?: boolean } = {},
) {
  const term = "term" in opts ? opts.term : ({ cols: 100, rows: 30 } as unknown as Terminal);
  const fit = "fit" in opts ? opts.fit : ({ fit: vi.fn() } as unknown as FitAddon);
  const container = document.createElement("div");
  vi.spyOn(container, "getBoundingClientRect").mockReturnValue({
    width: opts.measurable === false ? 0 : 640,
    height: opts.measurable === false ? 0 : 320,
  } as DOMRect);
  const send = vi.fn<(m: SentMsg) => void>();
  const rendered = renderHook(() => {
    const containerRef = useRef(container);
    const termRef = useRef(term ?? null);
    const fitRef = useRef(fit ?? null);
    const disposedRef = useRef(false);
    return useTerminalSizeSync({
      containerRef,
      termRef,
      fitAddonRef: fitRef,
      disposedRef,
      socketSend: send,
      role,
      active: opts.active ?? true,
    });
  });
  return { ...rendered, send };
}

const resizes = (send: ReturnType<typeof vi.fn>) =>
  send.mock.calls.filter((c) => (c[0] as SentMsg)?.type === "resize");

describe("useTerminalSizeSync", () => {
  it("syncSizeNow fits + emits a resize with the terminal's real dims", () => {
    const { result, send } = mount("writer");
    result.current.syncSizeNow();
    expect(send).toHaveBeenCalledWith({ type: "resize", cols: 100, rows: 30 });
  });

  it("syncSizeNow is a no-op when the terminal is not mounted", () => {
    const { result, send } = mount("writer", { term: null });
    result.current.syncSizeNow();
    expect(send).not.toHaveBeenCalled();
  });

  it("never fits or resizes a hidden force-mounted terminal", () => {
    const fit = { fit: vi.fn() } as unknown as FitAddon;
    const { result, send } = mount("writer", { fit, active: false, measurable: false });
    result.current.onReplaySettled();
    expect(fit.fit).not.toHaveBeenCalled();
    expect(resizes(send)).toHaveLength(0);
  });

  it("drops an unusable grid produced by fit", () => {
    const term = { cols: 100, rows: 30 } as unknown as Terminal;
    const fit = { fit: vi.fn(() => {
      Object.assign(term, { cols: 2, rows: 1 });
    }) } as unknown as FitAddon;
    const { result, send } = mount("writer", { term, fit });
    result.current.syncSizeNow();
    expect(resizes(send)).toHaveLength(0);
  });

  it("onReplaySettled re-converges a WRITER (emits a resize)", () => {
    const { result, send } = mount("writer");
    result.current.onReplaySettled();
    expect(resizes(send)).toHaveLength(1);
  });

  it("onReplaySettled does NOT converge a READER (#150 reader-reflow guard)", () => {
    const { result, send } = mount("reader");
    result.current.onReplaySettled();
    expect(send).not.toHaveBeenCalled();
  });

  it("onReplaySettled does NOT converge before a role is known (null)", () => {
    const { result, send } = mount(null);
    result.current.onReplaySettled();
    expect(send).not.toHaveBeenCalled();
  });
});

/*
 * Post-replay redraw nudge (iterate-2026-07-27, FR-01.28).
 *
 * The resize above is NOT enough: a re-attach usually lands at the SAME
 * cols/rows and the server deliberately dedupes a no-op resize (v0.8.6 AC-2),
 * so no SIGWINCH reaches Claude Code and it never learns the grid beneath it is
 * a restored snapshot (ADR-087) rather than the one it drew. Its next repaint is
 * differential — CUF (`ESC [ 1 C`) cell-skips, which do not erase — so every
 * skipped cell keeps a stale character. See
 * server/src/terminal/cuf-stale-cell-repro.test.ts for the mechanism.
 */
describe("useTerminalSizeSync — post-replay redraw nudge", () => {
  const redraws = (send: ReturnType<typeof vi.fn>) =>
    send.mock.calls.filter((c) => c[0]?.type === "redraw");

  it("a WRITER emits a redraw frame after the replay settles", () => {
    const { result, send } = mount("writer");
    result.current.onReplaySettled();
    expect(redraws(send)).toHaveLength(1);
  });

  it("emits the redraw AFTER the resize, so the pty is sized before it repaints", () => {
    const { result, send } = mount("writer");
    result.current.onReplaySettled();
    const types = send.mock.calls.map((c) => c[0]?.type);
    expect(types).toEqual(["resize", "redraw"]);
  });

  it("carries NO dimensions — the caller must not be able to reflow the grid it is repairing", () => {
    const { result, send } = mount("writer");
    result.current.onReplaySettled();
    expect(redraws(send)[0][0]).toEqual({ type: "redraw" });
  });

  it("a READER emits NOTHING AT ALL (not merely no redraw)", () => {
    // Filtering only redraw frames would pass even if a reader wrongly emitted
    // a resize, reflowing the snapshot width (#150) — external review LOW.
    const { result, send } = mount("reader");
    result.current.onReplaySettled();
    expect(send).not.toHaveBeenCalled();
  });

  it("emits exactly ONE redraw per settled replay (the dedupe is bypassed server-side)", () => {
    // Two settles = two nudges is fine; what must never happen is a burst per
    // settle, which would re-create the v0.8.6 banner spam.
    const { result, send } = mount("writer");
    result.current.onReplaySettled();
    expect(redraws(send)).toHaveLength(1);
    result.current.onReplaySettled();
    expect(redraws(send)).toHaveLength(2);
  });

  it("syncSizeNow alone does NOT emit a redraw (launch path stays untouched)", () => {
    const { result, send } = mount("writer");
    result.current.syncSizeNow();
    expect(redraws(send)).toHaveLength(0);
  });
});
