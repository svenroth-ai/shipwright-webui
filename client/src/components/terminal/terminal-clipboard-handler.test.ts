/*
 * terminal-clipboard-handler.test — createClipboardKeyHandler.
 *
 * iterate-2026-05-18-terminal-copy-paste. The handler is the load-bearing
 * decision logic (copy vs SIGINT, paste, repeat-guard, clear-on-success).
 * It is dependency-injected, so it is exercised here with fake xterm +
 * fake clipboard ops — no DOM, no mounted component. The real-browser
 * keyboard path is covered by the Playwright E2E (synthetic events are
 * NOT sufficient evidence — v0.8.2 false-positive lesson).
 *
 * Split out of terminal-clipboard.test.ts to keep each test file under
 * the 300-line convention.
 */
import { describe, expect, it, vi } from "vitest";
import {
  createClipboardKeyHandler,
  type ClipboardTerminal,
  type PasteRead,
} from "./terminal-clipboard";

/** Flush queued microtasks + the setTimeout(0) tick so `.then` runs. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type FakeTerminal = ClipboardTerminal & {
  hasSelection: ReturnType<typeof vi.fn>;
  getSelection: ReturnType<typeof vi.fn>;
  clearSelection: ReturnType<typeof vi.fn>;
  paste: ReturnType<typeof vi.fn>;
};

function fakeTerm(selection = ""): FakeTerminal {
  return {
    hasSelection: vi.fn(() => selection.length > 0),
    getSelection: vi.fn(() => selection),
    clearSelection: vi.fn(),
    paste: vi.fn(),
  };
}

function keyEvent(partial: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    type: "keydown",
    ctrlKey: false,
    shiftKey: false,
    metaKey: false,
    altKey: false,
    repeat: false,
    key: "",
    preventDefault: vi.fn(),
    stopPropagation: vi.fn(),
    ...partial,
  } as unknown as KeyboardEvent;
}

interface HarnessOverrides {
  selection?: string;
  isDisposed?: () => boolean;
  copy?: (text: string) => Promise<void>;
  readClipboard?: () => Promise<PasteRead>;
}

function harness(over: HarnessOverrides = {}) {
  const term = fakeTerm(over.selection ?? "");
  const notify = vi.fn();
  const copy = over.copy ?? vi.fn(async () => {});
  const readClipboard =
    over.readClipboard ??
    vi.fn(async (): Promise<PasteRead> => ({ ok: true, text: "CLIP" }));
  const handler = createClipboardKeyHandler({
    term,
    isDisposed: over.isDisposed ?? (() => false),
    notify,
    copy,
    readClipboard,
  });
  return { term, notify, copy, readClipboard, handler };
}

describe("createClipboardKeyHandler — copy", () => {
  it("Ctrl+C with a selection copies it and suppresses the key", async () => {
    const h = harness({ selection: "hello world" });
    const ev = keyEvent({ ctrlKey: true, key: "c" });
    expect(h.handler(ev)).toBe(false);
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(h.copy).toHaveBeenCalledWith("hello world");
    await flush();
    expect(h.term.clearSelection).toHaveBeenCalled();
    expect(h.notify).toHaveBeenCalledWith("copied");
  });

  it("Ctrl+Insert with a selection copies it", async () => {
    const h = harness({ selection: "abc" });
    expect(h.handler(keyEvent({ ctrlKey: true, key: "Insert" }))).toBe(false);
    expect(h.copy).toHaveBeenCalledWith("abc");
    await flush();
    expect(h.notify).toHaveBeenCalledWith("copied");
  });

  it("Ctrl+C with NO selection passes through (→ SIGINT), no copy", () => {
    const h = harness({ selection: "" });
    const ev = keyEvent({ ctrlKey: true, key: "c" });
    expect(h.handler(ev)).toBe(true);
    expect(h.copy).not.toHaveBeenCalled();
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it("Ctrl+C with a whitespace-only selection passes through", () => {
    const h = harness({ selection: "  \n\t " });
    expect(h.handler(keyEvent({ ctrlKey: true, key: "c" }))).toBe(true);
    expect(h.copy).not.toHaveBeenCalled();
  });

  it("a failed copy notifies but does NOT clear the selection (retry-safe)", async () => {
    const h = harness({
      selection: "data",
      copy: vi.fn(async () => {
        throw new Error("execCommand failed");
      }),
    });
    h.handler(keyEvent({ ctrlKey: true, key: "c" }));
    await flush();
    expect(h.notify).toHaveBeenCalledWith("copy-failed");
    expect(h.term.clearSelection).not.toHaveBeenCalled();
  });

  it("a held Ctrl+C (ev.repeat) with a selection copies only once", () => {
    const h = harness({ selection: "data" });
    const ev = keyEvent({ ctrlKey: true, key: "c", repeat: true });
    expect(h.handler(ev)).toBe(false);
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(h.copy).not.toHaveBeenCalled();
  });

  it("does not clear selection / notify when the terminal is disposed", async () => {
    const h = harness({ selection: "data", isDisposed: () => true });
    h.handler(keyEvent({ ctrlKey: true, key: "c" }));
    await flush();
    expect(h.term.clearSelection).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });
});

describe("createClipboardKeyHandler — paste", () => {
  it("Ctrl+V reads the clipboard and pastes via term.paste()", async () => {
    const h = harness({
      readClipboard: vi.fn(async (): Promise<PasteRead> => ({ ok: true, text: "pasted" })),
    });
    const ev = keyEvent({ ctrlKey: true, key: "v" });
    expect(h.handler(ev)).toBe(false);
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(ev.stopPropagation).toHaveBeenCalled();
    await flush();
    expect(h.term.paste).toHaveBeenCalledWith("pasted");
  });

  it("Shift+Insert pastes via the same path", async () => {
    const h = harness({
      readClipboard: vi.fn(async (): Promise<PasteRead> => ({ ok: true, text: "si" })),
    });
    expect(h.handler(keyEvent({ shiftKey: true, key: "Insert" }))).toBe(false);
    await flush();
    expect(h.term.paste).toHaveBeenCalledWith("si");
  });

  it("preserves a multi-line clipboard payload through term.paste()", async () => {
    const multi = "first section\nline two\n\nsecond section";
    const h = harness({
      readClipboard: vi.fn(async (): Promise<PasteRead> => ({ ok: true, text: multi })),
    });
    h.handler(keyEvent({ ctrlKey: true, key: "v" }));
    await flush();
    expect(h.term.paste).toHaveBeenCalledWith(multi);
  });

  it("Ctrl+V in a non-secure context shows the paste hint, no paste", async () => {
    const h = harness({
      readClipboard: vi.fn(async (): Promise<PasteRead> => ({ ok: false, reason: "unavailable" })),
    });
    h.handler(keyEvent({ ctrlKey: true, key: "v" }));
    await flush();
    expect(h.notify).toHaveBeenCalledWith("paste-hint");
    expect(h.term.paste).not.toHaveBeenCalled();
  });

  it("Ctrl+V with a denied clipboard read shows 'paste-failed'", async () => {
    const h = harness({
      readClipboard: vi.fn(async (): Promise<PasteRead> => ({ ok: false, reason: "denied" })),
    });
    h.handler(keyEvent({ ctrlKey: true, key: "v" }));
    await flush();
    expect(h.notify).toHaveBeenCalledWith("paste-failed");
  });

  it("an empty clipboard read pastes nothing (no-op, no notice)", async () => {
    const h = harness({
      readClipboard: vi.fn(async (): Promise<PasteRead> => ({ ok: true, text: "" })),
    });
    h.handler(keyEvent({ ctrlKey: true, key: "v" }));
    await flush();
    expect(h.term.paste).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });

  it("a held Ctrl+V (ev.repeat) pastes only once", () => {
    const h = harness();
    const ev = keyEvent({ ctrlKey: true, key: "v", repeat: true });
    expect(h.handler(ev)).toBe(false);
    expect(ev.preventDefault).toHaveBeenCalled();
    expect(h.readClipboard).not.toHaveBeenCalled();
  });
});

describe("createClipboardKeyHandler — passthrough", () => {
  it("Ctrl+Shift+C passes through untouched (not a bound chord)", () => {
    const h = harness({ selection: "data" });
    const ev = keyEvent({ ctrlKey: true, shiftKey: true, key: "C" });
    expect(h.handler(ev)).toBe(true);
    expect(h.copy).not.toHaveBeenCalled();
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it("keyup of Ctrl+C passes through (only keydown is handled)", () => {
    const h = harness({ selection: "data" });
    expect(
      h.handler(keyEvent({ type: "keyup", ctrlKey: true, key: "c" })),
    ).toBe(true);
    expect(h.copy).not.toHaveBeenCalled();
  });

  it("a plain typed key passes through", () => {
    const h = harness();
    expect(h.handler(keyEvent({ key: "a" }))).toBe(true);
  });
});
