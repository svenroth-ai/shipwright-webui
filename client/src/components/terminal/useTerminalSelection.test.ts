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

function attach(selection = "SELECTED-TEXT") {
  const el = document.createElement("div");
  document.body.appendChild(el);
  const dispose = attachTerminalSelection({
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    term: fakeTerm(selection, el) as any,
    disposedRef: { current: false },
    setMouseEventsActive: vi.fn(),
    setBannerDismissed: vi.fn(),
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
