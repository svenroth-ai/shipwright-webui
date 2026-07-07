/*
 * terminal-clipboard.test — chord classifier + paste-read helper.
 *
 * iterate-2026-05-18-terminal-copy-paste. The classifier is pure, so it
 * gets an exhaustive chord table. `readClipboardForPaste` is exercised
 * for all three outcomes: API absent (non-secure context / Tailscale
 * http), readText resolving, and readText rejecting (permission denied).
 *
 * The `createClipboardKeyHandler` tests live in the sibling
 * terminal-clipboard-handler.test.ts (split to keep each file < 300 LOC).
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  classifyClipboardChord,
  readClipboardForPaste,
  type ChordEventLike,
} from "./terminal-clipboard";

function ev(partial: Partial<ChordEventLike>): ChordEventLike {
  return {
    type: "keydown",
    ctrlKey: false,
    shiftKey: false,
    metaKey: false,
    altKey: false,
    key: "",
    ...partial,
  };
}

describe("classifyClipboardChord", () => {
  it("Ctrl+C → passthrough (copy is OSC 52 now; Ctrl+C stays interrupt)", () => {
    expect(classifyClipboardChord(ev({ ctrlKey: true, key: "c" }))).toBe(
      "passthrough",
    );
  });

  it("Ctrl+Insert → passthrough (no longer a copy chord)", () => {
    expect(classifyClipboardChord(ev({ ctrlKey: true, key: "Insert" }))).toBe(
      "passthrough",
    );
  });

  it("Ctrl+V → paste", () => {
    expect(classifyClipboardChord(ev({ ctrlKey: true, key: "v" }))).toBe(
      "paste",
    );
  });

  it("Shift+Insert → paste", () => {
    expect(classifyClipboardChord(ev({ shiftKey: true, key: "Insert" }))).toBe(
      "paste",
    );
  });

  it("Ctrl+Shift+C → passthrough (not bound)", () => {
    expect(
      classifyClipboardChord(ev({ ctrlKey: true, shiftKey: true, key: "C" })),
    ).toBe("passthrough");
  });

  it("Ctrl+Shift+V → passthrough", () => {
    expect(
      classifyClipboardChord(ev({ ctrlKey: true, shiftKey: true, key: "V" })),
    ).toBe("passthrough");
  });

  it("Ctrl+Shift+Insert → passthrough", () => {
    expect(
      classifyClipboardChord(
        ev({ ctrlKey: true, shiftKey: true, key: "Insert" }),
      ),
    ).toBe("passthrough");
  });

  it("Meta+C (macOS) → passthrough (native browser copy)", () => {
    expect(classifyClipboardChord(ev({ metaKey: true, key: "c" }))).toBe(
      "passthrough",
    );
  });

  it("Meta+V (macOS) → passthrough (native browser paste)", () => {
    expect(classifyClipboardChord(ev({ metaKey: true, key: "v" }))).toBe(
      "passthrough",
    );
  });

  it("Alt+V → passthrough (Claude TUI image-paste, never intercepted)", () => {
    expect(classifyClipboardChord(ev({ altKey: true, key: "v" }))).toBe(
      "passthrough",
    );
  });

  it("plain c (no modifier) → passthrough", () => {
    expect(classifyClipboardChord(ev({ key: "c" }))).toBe("passthrough");
  });

  it("Ctrl+A → passthrough", () => {
    expect(classifyClipboardChord(ev({ ctrlKey: true, key: "a" }))).toBe(
      "passthrough",
    );
  });

  it("keyup of Ctrl+C → passthrough (only keydown is classified)", () => {
    expect(
      classifyClipboardChord(ev({ type: "keyup", ctrlKey: true, key: "c" })),
    ).toBe("passthrough");
  });

  it("keypress → passthrough", () => {
    expect(
      classifyClipboardChord(ev({ type: "keypress", ctrlKey: true, key: "c" })),
    ).toBe("passthrough");
  });

  it("uppercase Ctrl+C (caps lock) → passthrough", () => {
    expect(classifyClipboardChord(ev({ ctrlKey: true, key: "C" }))).toBe(
      "passthrough",
    );
  });
});

describe("readClipboardForPaste", () => {
  const originalClipboard = Object.getOwnPropertyDescriptor(
    navigator,
    "clipboard",
  );

  afterEach(() => {
    if (originalClipboard) {
      Object.defineProperty(navigator, "clipboard", originalClipboard);
    } else {
      // jsdom may not define `clipboard` at all — remove the stub.
      delete (navigator as { clipboard?: unknown }).clipboard;
    }
  });

  function stubClipboard(value: unknown): void {
    Object.defineProperty(navigator, "clipboard", {
      value,
      configurable: true,
    });
  }

  it("returns unavailable when navigator.clipboard is absent", async () => {
    stubClipboard(undefined);
    await expect(readClipboardForPaste()).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("returns unavailable when readText is not a function", async () => {
    stubClipboard({});
    await expect(readClipboardForPaste()).resolves.toEqual({
      ok: false,
      reason: "unavailable",
    });
  });

  it("returns the text when readText resolves", async () => {
    stubClipboard({ readText: vi.fn(async () => "pasted-content") });
    await expect(readClipboardForPaste()).resolves.toEqual({
      ok: true,
      text: "pasted-content",
    });
  });

  it("preserves a multi-line string with blank lines verbatim", async () => {
    const multi = "section one\nline two\n\nsection two\nline four";
    stubClipboard({ readText: vi.fn(async () => multi) });
    const result = await readClipboardForPaste();
    expect(result).toEqual({ ok: true, text: multi });
  });

  it("returns denied when readText rejects (permission denied)", async () => {
    stubClipboard({
      readText: vi.fn(async () => {
        throw new Error("NotAllowedError");
      }),
    });
    await expect(readClipboardForPaste()).resolves.toEqual({
      ok: false,
      reason: "denied",
    });
  });
});
