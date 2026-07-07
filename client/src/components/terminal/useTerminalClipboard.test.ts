/*
 * useTerminalClipboard — transient clipboard-notice state (notice-only after
 * iterate-2026-07-07-terminal-osc52-clipboard removed the selection cache +
 * Copy pill). Notice kinds: copy-failed (OSC 52 relay) / paste-hint /
 * paste-failed (paste handler).
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

import { useTerminalClipboard } from "./useTerminalClipboard";

describe("useTerminalClipboard — notice", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("notify surfaces a notice; dismiss clears it", () => {
    const { result } = renderHook(() => useTerminalClipboard());
    expect(result.current.clipboardNotice).toBeNull();
    act(() => result.current.notify("paste-hint"));
    expect(result.current.clipboardNotice).toBe("paste-hint");
    act(() => result.current.dismissClipboardNotice());
    expect(result.current.clipboardNotice).toBeNull();
  });

  it("auto-dismisses after the per-kind duration", () => {
    const { result } = renderHook(() => useTerminalClipboard());
    act(() => result.current.notify("copy-failed"));
    expect(result.current.clipboardNotice).toBe("copy-failed");
    act(() => vi.advanceTimersByTime(8000));
    expect(result.current.clipboardNotice).toBeNull();
  });

  it("keeps notify / dismiss identities stable across renders", () => {
    const { result, rerender } = renderHook(() => useTerminalClipboard());
    const n = result.current.notify;
    const d = result.current.dismissClipboardNotice;
    rerender();
    expect(result.current.notify).toBe(n);
    expect(result.current.dismissClipboardNotice).toBe(d);
  });
});
