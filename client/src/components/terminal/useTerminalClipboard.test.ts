/*
 * useTerminalClipboard — selection cache + Copy-pill state + clipboard notice.
 * iterate-2026-07-06-terminal-copy-selection-cache.
 *
 * The hook owns the redraw-proof copy cache: `captureSelection` stores the
 * last non-empty terminal selection so an explicit copy (Ctrl+C / pill) can
 * read it AFTER Claude's mouse-tracking redraw has already wiped the live
 * xterm selection. `getCachedSelection` feeds the keyboard handler's
 * fallback; `copyableSelection` drives the mouse-only Copy pill.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";

vi.mock("../../lib/clipboard", () => ({ copyText: vi.fn(async () => {}) }));
import { copyText } from "../../lib/clipboard";
import { useTerminalClipboard } from "./useTerminalClipboard";

const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

function setup() {
  const disposedRef = { current: false };
  return { disposedRef, ...renderHook(() => useTerminalClipboard({ disposedRef })) };
}

describe("useTerminalClipboard — selection cache", () => {
  beforeEach(() => {
    vi.mocked(copyText).mockClear().mockResolvedValue(undefined);
  });

  it("captureSelection stores the cache and shows the Copy pill", () => {
    const { result } = setup();
    expect(result.current.copyableSelection).toBeNull();
    act(() => result.current.captureSelection("HELLO123"));
    expect(result.current.copyableSelection).toBe("HELLO123");
    expect(result.current.getCachedSelection()).toBe("HELLO123");
  });

  it("ignores an empty / whitespace-only capture", () => {
    const { result } = setup();
    act(() => result.current.captureSelection("   \n\t"));
    expect(result.current.copyableSelection).toBeNull();
    expect(result.current.getCachedSelection()).toBe("");
  });

  it("invalidateSelection clears the cache and hides the pill", () => {
    const { result } = setup();
    act(() => result.current.captureSelection("X"));
    act(() => result.current.invalidateSelection());
    expect(result.current.copyableSelection).toBeNull();
    expect(result.current.getCachedSelection()).toBe("");
  });

  it("onCopySelection copies the cached text, then clears the pill", async () => {
    const { result } = setup();
    act(() => result.current.captureSelection("COPY-ME"));
    await act(async () => {
      result.current.onCopySelection();
      await flush();
    });
    expect(copyText).toHaveBeenCalledWith("COPY-ME");
    expect(result.current.copyableSelection).toBeNull();
  });

  it("onCopySelection is a no-op when the cache is empty", async () => {
    const { result } = setup();
    await act(async () => {
      result.current.onCopySelection();
      await flush();
    });
    expect(copyText).not.toHaveBeenCalled();
  });

  it("a failed copy notifies copy-failed and keeps the pill (retry-safe)", async () => {
    vi.mocked(copyText).mockRejectedValueOnce(new Error("execCommand failed"));
    const { result } = setup();
    act(() => result.current.captureSelection("KEEP"));
    await act(async () => {
      result.current.onCopySelection();
      await flush();
    });
    expect(result.current.clipboardNotice).toBe("copy-failed");
    expect(result.current.copyableSelection).toBe("KEEP");
  });

  it("does not touch the clipboard once disposed", async () => {
    const { result, disposedRef } = setup();
    act(() => result.current.captureSelection("Z"));
    disposedRef.current = true;
    await act(async () => {
      result.current.onCopySelection();
      await flush();
    });
    expect(copyText).not.toHaveBeenCalled();
  });

  it("keeps callback identities stable across renders", () => {
    const { result, rerender } = setup();
    const cap = result.current.captureSelection;
    const inv = result.current.invalidateSelection;
    const get = result.current.getCachedSelection;
    rerender();
    expect(result.current.captureSelection).toBe(cap);
    expect(result.current.invalidateSelection).toBe(inv);
    expect(result.current.getCachedSelection).toBe(get);
  });
});

describe("useTerminalClipboard — notice", () => {
  it("notify surfaces a notice; dismiss clears it", () => {
    const { result } = setup();
    act(() => result.current.notify("copied"));
    expect(result.current.clipboardNotice).toBe("copied");
    act(() => result.current.dismissClipboardNotice());
    expect(result.current.clipboardNotice).toBeNull();
  });
});
