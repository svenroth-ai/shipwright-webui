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

function mount(
  role: TerminalRole | null,
  opts: { term?: Terminal | null; fit?: FitAddon | null } = {},
) {
  const term = "term" in opts ? opts.term : ({ cols: 100, rows: 30 } as unknown as Terminal);
  const fit = "fit" in opts ? opts.fit : ({ fit: vi.fn() } as unknown as FitAddon);
  const send = vi.fn<(m: ResizeMsg) => void>();
  const rendered = renderHook(() => {
    const termRef = useRef(term ?? null);
    const fitRef = useRef(fit ?? null);
    const disposedRef = useRef(false);
    return useTerminalSizeSync({
      termRef,
      fitAddonRef: fitRef,
      disposedRef,
      socketSend: send,
      role,
    });
  });
  return { ...rendered, send };
}

const resizes = (send: ReturnType<typeof vi.fn>) =>
  send.mock.calls.filter((c) => (c[0] as ResizeMsg)?.type === "resize");

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
