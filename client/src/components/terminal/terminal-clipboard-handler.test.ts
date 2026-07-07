/*
 * terminal-clipboard-handler.test — createClipboardKeyHandler (PASTE only).
 *
 * iterate-2026-05-18-terminal-copy-paste; COPY handling removed in
 * iterate-2026-07-07-terminal-osc52-clipboard (Claude copies via OSC 52; the
 * WebUI relays it — see terminal-osc52.test.ts). The handler now only
 * intercepts paste; every other key (incl. Ctrl+C) passes through. It is
 * dependency-injected, so it is exercised here with a fake xterm + fake
 * clipboard read — no DOM, no mounted component. The real-browser keyboard
 * path is covered by the Playwright E2E (synthetic events are NOT sufficient
 * evidence — v0.8.2 false-positive lesson).
 */
import { describe, expect, it, vi } from "vitest";
import {
  createClipboardKeyHandler,
  type ClipboardTerminal,
  type PasteRead,
} from "./terminal-clipboard";

/** Flush queued microtasks + the setTimeout(0) tick so `.then` runs. */
const flush = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

type FakeTerminal = ClipboardTerminal & { paste: ReturnType<typeof vi.fn> };

function fakeTerm(): FakeTerminal {
  return { paste: vi.fn<(data: string) => void>() };
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
  isDisposed?: () => boolean;
  readClipboard?: () => Promise<PasteRead>;
}

function harness(over: HarnessOverrides = {}) {
  const term = fakeTerm();
  const notify = vi.fn();
  const readClipboard =
    over.readClipboard ??
    vi.fn(async (): Promise<PasteRead> => ({ ok: true, text: "CLIP" }));
  const handler = createClipboardKeyHandler({
    term,
    isDisposed: over.isDisposed ?? (() => false),
    notify,
    readClipboard,
  });
  return { term, notify, readClipboard, handler };
}

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

  it("does not paste once the terminal is disposed", async () => {
    const h = harness({ isDisposed: () => true });
    h.handler(keyEvent({ ctrlKey: true, key: "v" }));
    await flush();
    expect(h.term.paste).not.toHaveBeenCalled();
    expect(h.notify).not.toHaveBeenCalled();
  });
});

describe("createClipboardKeyHandler — passthrough (copy removed)", () => {
  it("Ctrl+C passes through untouched (interrupt reaches the pty)", () => {
    const h = harness();
    const ev = keyEvent({ ctrlKey: true, key: "c" });
    expect(h.handler(ev)).toBe(true);
    expect(ev.preventDefault).not.toHaveBeenCalled();
    expect(h.term.paste).not.toHaveBeenCalled();
  });

  it("Ctrl+Insert passes through (no longer a copy chord)", () => {
    const h = harness();
    expect(h.handler(keyEvent({ ctrlKey: true, key: "Insert" }))).toBe(true);
  });

  it("Ctrl+Shift+C passes through untouched", () => {
    const h = harness();
    const ev = keyEvent({ ctrlKey: true, shiftKey: true, key: "C" });
    expect(h.handler(ev)).toBe(true);
    expect(ev.preventDefault).not.toHaveBeenCalled();
  });

  it("keyup of Ctrl+V passes through (only keydown is handled)", () => {
    const h = harness();
    expect(h.handler(keyEvent({ type: "keyup", ctrlKey: true, key: "v" }))).toBe(
      true,
    );
    expect(h.readClipboard).not.toHaveBeenCalled();
  });

  it("a plain typed key passes through", () => {
    const h = harness();
    expect(h.handler(keyEvent({ key: "a" }))).toBe(true);
  });
});
