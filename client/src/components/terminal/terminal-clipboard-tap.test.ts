/*
 * terminal-clipboard-tap.test — the touch "Paste" key-bar path
 * (iterate-2026-10-10-mobile-taskdetail-favicon). iOS has no long-press paste
 * menu on the terminal, so a tap reads the clipboard and routes like Ctrl+V.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { pasteFromClipboardTap } from "./terminal-clipboard";

function stubClipboard(readText: () => Promise<string>) {
  Object.defineProperty(navigator, "clipboard", {
    configurable: true,
    value: { readText },
  });
}
function deps(over: Partial<Parameters<typeof pasteFromClipboardTap>[0]> = {}) {
  return {
    term: { paste: vi.fn() },
    writer: true,
    isDisposed: () => false,
    notify: vi.fn(),
    uploadImage: vi.fn(),
    ...over,
  };
}

describe("pasteFromClipboardTap", () => {
  afterEach(() => Reflect.deleteProperty(navigator, "clipboard"));

  // @covers FR-01.38
  it("pastes clipboard text through term.paste", async () => {
    stubClipboard(async () => "hello\nworld");
    const d = deps();
    await pasteFromClipboardTap(d);
    expect(d.term!.paste).toHaveBeenCalledWith("hello\nworld");
    expect(d.notify).not.toHaveBeenCalled();
  });

  // @covers FR-01.38
  it("does nothing for a read-only reader (never pokes the pty)", async () => {
    stubClipboard(async () => "x");
    const d = deps({ writer: false });
    await pasteFromClipboardTap(d);
    expect(d.term!.paste).not.toHaveBeenCalled();
  });

  // @covers FR-01.38
  it("shows the paste-hint when the async Clipboard API is absent (http)", async () => {
    const d = deps();
    await pasteFromClipboardTap(d);
    expect(d.notify).toHaveBeenCalledWith("paste-hint");
  });

  // @covers FR-01.38
  it("shows paste-failed when the read is denied", async () => {
    stubClipboard(async () => {
      throw new Error("denied");
    });
    const d = deps();
    await pasteFromClipboardTap(d);
    expect(d.notify).toHaveBeenCalledWith("paste-failed");
  });

  // @covers FR-01.38
  it("drops the result after the terminal was disposed", async () => {
    stubClipboard(async () => "late");
    const d = deps({ isDisposed: () => true });
    await pasteFromClipboardTap(d);
    expect(d.term!.paste).not.toHaveBeenCalled();
  });
});

describe("pasteFromClipboardTap — failure containment", () => {
  afterEach(() => Reflect.deleteProperty(navigator, "clipboard"));

  // @covers FR-01.38
  it("turns a throwing term.paste into a paste-failed notice (no unhandled rejection)", async () => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { readText: async () => "x" },
    });
    const d = deps({ term: { paste: vi.fn(() => { throw new Error("boom"); }) } });
    await expect(pasteFromClipboardTap(d)).resolves.toBeUndefined();
    expect(d.notify).toHaveBeenCalledWith("paste-failed");
  });
});
