/*
 * Pure unit tests for the Ctrl+V clipboard-paste helpers (iterate v0.8.3 AC-1).
 *
 * Two surfaces:
 *   - shouldInterceptCtrlV(ev): the decision tree wired into xterm's
 *     attachCustomKeyEventHandler. Must return TRUE only for the
 *     "Ctrl+V keydown without other modifiers" event so we don't
 *     re-fire on keyup, swallow Ctrl+Shift+V, or trip on Alt+V.
 *   - readClipboardForPaste(navigator): async decoder that walks
 *     navigator.clipboard.read() output and returns a discriminated
 *     union the caller routes to upload (image) vs socket.send (text).
 *
 * The integration tests in EmbeddedTerminal.test.tsx exercise both
 * helpers together via the xterm key-event mock; here we cover the
 * decision tree exhaustively.
 */

import { describe, it, expect, vi } from "vitest";
import { readClipboardForPaste, shouldInterceptCtrlV } from "./clipboard-paste";

function key(
  type: "keydown" | "keyup" | "keypress",
  init: Partial<KeyboardEventInit> & { key: string },
): KeyboardEvent {
  return new KeyboardEvent(type, init);
}

describe("shouldInterceptCtrlV (decision tree)", () => {
  it("intercepts plain Ctrl+V keydown", () => {
    expect(shouldInterceptCtrlV(key("keydown", { key: "v", ctrlKey: true }))).toBe(true);
  });

  it("intercepts uppercase V keydown (Ctrl+Shift held? — no, plain key reported as 'V' by some layouts)", () => {
    // Some keyboard layouts report "V" not "v" — we match case-insensitively.
    expect(shouldInterceptCtrlV(key("keydown", { key: "V", ctrlKey: true }))).toBe(true);
  });

  it("does NOT intercept keyup — only keydown drives the async clipboard.read", () => {
    expect(shouldInterceptCtrlV(key("keyup", { key: "v", ctrlKey: true }))).toBe(false);
  });

  it("does NOT intercept keypress (deprecated but still synthesized in some browsers)", () => {
    expect(shouldInterceptCtrlV(key("keypress", { key: "v", ctrlKey: true }))).toBe(false);
  });

  it("does NOT intercept Ctrl+Shift+V (xterm's own bracketed-paste shortcut stays available)", () => {
    expect(
      shouldInterceptCtrlV(key("keydown", { key: "v", ctrlKey: true, shiftKey: true })),
    ).toBe(false);
  });

  it("does NOT intercept Ctrl+Alt+V (Alt+V already binds to xterm's text-paste path)", () => {
    expect(
      shouldInterceptCtrlV(key("keydown", { key: "v", ctrlKey: true, altKey: true })),
    ).toBe(false);
  });

  it("does NOT intercept Ctrl+Meta+V (macOS-ish chord, leave to OS)", () => {
    expect(
      shouldInterceptCtrlV(key("keydown", { key: "v", ctrlKey: true, metaKey: true })),
    ).toBe(false);
  });

  it("does NOT intercept just V (no Ctrl held)", () => {
    expect(shouldInterceptCtrlV(key("keydown", { key: "v" }))).toBe(false);
  });

  it("does NOT intercept Ctrl+C / Ctrl+X / Ctrl+A (other Ctrl-letter combos)", () => {
    expect(shouldInterceptCtrlV(key("keydown", { key: "c", ctrlKey: true }))).toBe(false);
    expect(shouldInterceptCtrlV(key("keydown", { key: "x", ctrlKey: true }))).toBe(false);
    expect(shouldInterceptCtrlV(key("keydown", { key: "a", ctrlKey: true }))).toBe(false);
  });
});

describe("readClipboardForPaste (async decoder)", () => {
  function fakeNav(items: ClipboardItem[] | null | "throw"): {
    clipboard: { read: () => Promise<ClipboardItem[]> };
  } {
    return {
      clipboard: {
        read: vi.fn(async () => {
          if (items === "throw") throw new Error("user denied clipboard");
          return items ?? [];
        }),
      },
    };
  }

  function makeItem(types: string[], blobs: Record<string, Blob>): ClipboardItem {
    return {
      types,
      getType: vi.fn(async (t: string) => blobs[t]) as unknown as (
        type: string,
      ) => Promise<Blob>,
      // ClipboardItem also has a `presentationStyle` field but we never
      // read it — TS happy-cast keeps the shim minimal.
    } as unknown as ClipboardItem;
  }

  it("returns 'unsupported' when navigator.clipboard.read is missing (Firefox case)", async () => {
    const nav = { clipboard: {} };
    const got = await readClipboardForPaste(nav);
    expect(got.kind).toBe("unsupported");
  });

  it("returns 'unsupported' when navigator.clipboard itself is undefined", async () => {
    const nav = {};
    const got = await readClipboardForPaste(nav);
    expect(got.kind).toBe("unsupported");
  });

  it("returns 'empty' when the clipboard yields no items", async () => {
    const got = await readClipboardForPaste(fakeNav([]));
    expect(got.kind).toBe("empty");
  });

  it("returns 'image' for image/png clipboard payload (image-wins primary path)", async () => {
    const blob = new Blob([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], { type: "image/png" });
    const item = makeItem(["image/png"], { "image/png": blob });
    const got = await readClipboardForPaste(fakeNav([item]));
    if (got.kind !== "image") throw new Error(`expected image, got ${got.kind}`);
    expect(got.mimeType).toBe("image/png");
    expect(got.blob).toBe(blob);
    expect(got.filename).toMatch(/^paste-\d+\.png$/);
  });

  it("respects image-wins precedence — image item wins over text-only sibling", async () => {
    const png = new Blob([new Uint8Array([0x89])], { type: "image/png" });
    const txt = new Blob(["hello"], { type: "text/plain" });
    const imageItem = makeItem(["image/png"], { "image/png": png });
    const textItem = makeItem(["text/plain"], { "text/plain": txt });
    // Order: text first, image second — should still pick image.
    const got = await readClipboardForPaste(fakeNav([textItem, imageItem]));
    expect(got.kind).toBe("image");
  });

  it("falls through to text/plain when no image item exists", async () => {
    const blob = new Blob(["hello world"], { type: "text/plain" });
    const item = makeItem(["text/plain"], { "text/plain": blob });
    const got = await readClipboardForPaste(fakeNav([item]));
    if (got.kind !== "text") throw new Error(`expected text, got ${got.kind}`);
    expect(got.text).toBe("hello world");
  });

  it("returns 'error' when clipboard.read() rejects (permission denied / DOMException)", async () => {
    const got = await readClipboardForPaste(fakeNav("throw"));
    if (got.kind !== "error") throw new Error(`expected error, got ${got.kind}`);
    expect(got.detail).toMatch(/user denied clipboard/);
  });

  it("returns 'error' when getType() rejects on the chosen image item", async () => {
    const item = {
      types: ["image/png"],
      getType: vi.fn(async () => {
        throw new Error("blob unavailable");
      }),
    } as unknown as ClipboardItem;
    const got = await readClipboardForPaste(fakeNav([item]));
    if (got.kind !== "error") throw new Error(`expected error, got ${got.kind}`);
    expect(got.detail).toMatch(/blob unavailable/);
  });

  it("returns 'empty' when items exist but expose neither image nor text/plain", async () => {
    const item = makeItem(["application/octet-stream"], {});
    const got = await readClipboardForPaste(fakeNav([item]));
    expect(got.kind).toBe("empty");
  });
});
