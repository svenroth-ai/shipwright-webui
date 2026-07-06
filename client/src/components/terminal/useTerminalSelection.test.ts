/*
 * useTerminalSelection — copy-on-selection gate
 * (iterate-2026-06-30-terminal-paste-single-sink).
 *
 * The auto-copy-on-selection path used to overwrite the OS clipboard on
 * every mouse selection, clobbering what the user was about to paste.
 * It is now OPT-IN: `attachTerminalSelection` consults `getCopyOnSelection()`
 * (lib/terminalPrefs, localStorage-backed) LIVE on every flush. These tests
 * pin both directions — OFF (default) must NOT touch the clipboard, ON must
 * copy — and that the value is re-read live (no re-attach needed).
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../../lib/clipboard", () => ({ copyText: vi.fn(async () => {}) }));
vi.mock("../../lib/terminalPrefs", () => ({ getCopyOnSelection: vi.fn(() => false) }));

import { attachTerminalSelection } from "./useTerminalSelection";
import { copyText } from "../../lib/clipboard";
import { getCopyOnSelection } from "../../lib/terminalPrefs";

function fakeTerm(selection: string, el: HTMLElement) {
  return {
    element: el,
    getSelection: () => selection,
    hasSelection: () => selection.length > 0,
    onSelectionChange: () => ({ dispose() {} }),
  };
}

function attach(
  selection = "SELECTED-TEXT",
  extra: {
    captureSelection?: (t: string) => void;
    invalidateSelection?: () => void;
  } = {},
) {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const dispose = attachTerminalSelection({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    term: fakeTerm(selection, el) as any,
    disposedRef: { current: false },
    setMouseEventsActive: vi.fn(),
    setBannerDismissed: vi.fn(),
    ...extra,
  });
  return { el, dispose };
}

function selectAndRelease(el: HTMLElement) {
  el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
}

describe("attachTerminalSelection — copy-on-selection gate", () => {
  beforeEach(() => {
    vi.mocked(copyText).mockClear();
    vi.mocked(getCopyOnSelection).mockReset().mockReturnValue(false);
    document.body.innerHTML = "";
  });

  it("does NOT copy on selection when the preference is OFF (default)", () => {
    vi.mocked(getCopyOnSelection).mockReturnValue(false);
    const { el, dispose } = attach();
    selectAndRelease(el);
    expect(copyText).not.toHaveBeenCalled();
    dispose();
  });

  it("copies the selection to the clipboard when the preference is ON", () => {
    vi.mocked(getCopyOnSelection).mockReturnValue(true);
    const { el, dispose } = attach();
    selectAndRelease(el);
    expect(copyText).toHaveBeenCalledTimes(1);
    expect(copyText).toHaveBeenCalledWith("SELECTED-TEXT");
    dispose();
  });

  it("re-reads the preference live (OFF→ON without re-attach)", () => {
    vi.mocked(getCopyOnSelection).mockReturnValue(false);
    const { el, dispose } = attach("LIVE-SEL");
    selectAndRelease(el);
    expect(copyText).not.toHaveBeenCalled();
    vi.mocked(getCopyOnSelection).mockReturnValue(true); // toggle flipped — no remount
    selectAndRelease(el);
    expect(copyText).toHaveBeenCalledWith("LIVE-SEL");
    dispose();
  });
});

describe("attachTerminalSelection — redraw-proof capture + invalidation", () => {
  beforeEach(() => {
    vi.mocked(copyText).mockClear();
    vi.mocked(getCopyOnSelection).mockReset().mockReturnValue(false);
    document.body.innerHTML = "";
  });

  it("captures the selection on mouseup even when copy-on-selection is OFF (no clipboard write)", () => {
    const captureSelection = vi.fn();
    const { el, dispose } = attach("PICK-ME", { captureSelection });
    selectAndRelease(el);
    expect(captureSelection).toHaveBeenCalledWith("PICK-ME");
    expect(copyText).not.toHaveBeenCalled(); // capture ≠ clipboard clobber (#186 kept)
    dispose();
  });

  it("still auto-copies AND captures on mouseup when copy-on-selection is ON", () => {
    vi.mocked(getCopyOnSelection).mockReturnValue(true);
    const captureSelection = vi.fn();
    const { el, dispose } = attach("BOTH", { captureSelection });
    selectAndRelease(el);
    expect(captureSelection).toHaveBeenCalledWith("BOTH");
    expect(copyText).toHaveBeenCalledWith("BOTH");
    dispose();
  });

  it("invalidates on a fresh mousedown gesture inside the terminal", () => {
    const invalidateSelection = vi.fn();
    const { el, dispose } = attach("X", { invalidateSelection });
    el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(invalidateSelection).toHaveBeenCalled();
    dispose();
  });

  it("invalidates on a committing keydown while the terminal is focused", () => {
    const invalidateSelection = vi.fn();
    const { el, dispose } = attach("X", { invalidateSelection });
    const input = document.createElement("textarea");
    el.appendChild(input);
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "a", bubbles: true }),
    );
    expect(invalidateSelection).toHaveBeenCalled();
    dispose();
  });

  it("does NOT invalidate on the Ctrl+C copy chord (cache must survive the copy read)", () => {
    const invalidateSelection = vi.fn();
    const { el, dispose } = attach("X", { invalidateSelection });
    const input = document.createElement("textarea");
    el.appendChild(input);
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "c", ctrlKey: true, bubbles: true }),
    );
    expect(invalidateSelection).not.toHaveBeenCalled();
    dispose();
  });

  it("does NOT invalidate on a bare modifier (Shift) keydown", () => {
    const invalidateSelection = vi.fn();
    const { el, dispose } = attach("X", { invalidateSelection });
    const input = document.createElement("textarea");
    el.appendChild(input);
    input.focus();
    input.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Shift", shiftKey: true, bubbles: true }),
    );
    expect(invalidateSelection).not.toHaveBeenCalled();
    dispose();
  });

  it("an OUTSIDE-origin mousedown clears the tracker so a stale selection can't resurrect on a later mouseup (review Finding A)", () => {
    // Repro of the cross-boundary SIGINT-hijack: a selection was tracked, the
    // live one is then gone (redraw), and a drag that STARTS outside the
    // terminal releases INSIDE it — the mouseup fallback must NOT re-arm the
    // stale text.
    const captureSelection = vi.fn();
    const el = document.createElement("div");
    document.body.appendChild(el);
    let sel = "STALE-OUTPUT";
    let fireSelectionChange: () => void = () => {};
    const term = {
      element: el,
      getSelection: () => sel,
      hasSelection: () => sel.length > 0,
      onSelectionChange: (cb: () => void) => {
        fireSelectionChange = cb;
        return { dispose() {} };
      },
    };
    const dispose = attachTerminalSelection({
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      term: term as any,
      disposedRef: { current: false },
      setMouseEventsActive: vi.fn(),
      setBannerDismissed: vi.fn(),
      captureSelection,
      invalidateSelection: vi.fn(),
    });
    fireSelectionChange(); // tracker = "STALE-OUTPUT"
    sel = ""; // redraw wiped the live selection

    const outside = document.createElement("div");
    document.body.appendChild(outside);
    try {
      outside.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      el.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      expect(captureSelection).not.toHaveBeenCalled();
    } finally {
      dispose();
      outside.remove();
    }
  });
});
