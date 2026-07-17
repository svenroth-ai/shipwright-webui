/*
 * useKeyboardMap — THE FENCE test (A21, FR-01.65, AC1 — the load-bearing AC).
 *
 * The task-detail screen hosts a LIVE pty. If a global keydown listener
 * swallows `t` / `j` / `k` / `/` / `?` while the terminal (or any text entry)
 * has focus, the operator can no longer type that letter into Claude and the
 * bytes reaching the pty change. This test proves the global map is INERT in
 * every typing context AND never `preventDefault()`s a key it will not handle.
 */
import { render, cleanup } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from "vitest";

import { useKeyboardMap, isTypingContext } from "./useKeyboardMap";

function Harness(props: {
  onOpenPalette: () => void;
  onOpenShortcuts: () => void;
}) {
  useKeyboardMap({
    onOpenPalette: props.onOpenPalette,
    onOpenShortcuts: props.onOpenShortcuts,
  });
  return (
    <div>
      <input data-testid="text-input" />
      <textarea data-testid="text-area" />
      <div data-testid="ce" contentEditable suppressContentEditableWarning />
      <div data-testid="embedded-terminal">
        <div data-testid="embedded-terminal-canvas">
          <textarea className="xterm-helper-textarea" />
        </div>
      </div>
      <div role="dialog" data-state="open" data-testid="open-dialog">
        <input data-testid="dialog-input" />
      </div>
    </div>
  );
}

function dispatch(
  el: Element | Document,
  init: KeyboardEventInit,
): { prevented: boolean } {
  const ev = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  const spy = vi.spyOn(ev, "preventDefault");
  el.dispatchEvent(ev);
  return { prevented: spy.mock.calls.length > 0 };
}

let onOpenPalette: Mock<() => void>;
let onOpenShortcuts: Mock<() => void>;

beforeEach(() => {
  onOpenPalette = vi.fn<() => void>();
  onOpenShortcuts = vi.fn<() => void>();
  render(<Harness onOpenPalette={onOpenPalette} onOpenShortcuts={onOpenShortcuts} />);
});
afterEach(() => cleanup());

describe("useKeyboardMap — positive (global keys fire from a neutral surface)", () => {
  it("opens the palette on Ctrl+K from document.body", () => {
    const { prevented } = dispatch(document.body, { key: "k", ctrlKey: true });
    expect(onOpenPalette).toHaveBeenCalledTimes(1);
    expect(prevented).toBe(true);
  });

  it("opens the palette on Meta+K (mac chord)", () => {
    dispatch(document.body, { key: "k", metaKey: true });
    expect(onOpenPalette).toHaveBeenCalledTimes(1);
  });

  it("opens the cheat-sheet on '?' from document.body", () => {
    dispatch(document.body, { key: "?" });
    expect(onOpenShortcuts).toHaveBeenCalledTimes(1);
  });

  it("never preventDefaults an unhandled key", () => {
    const { prevented } = dispatch(document.body, { key: "x" });
    expect(onOpenPalette).not.toHaveBeenCalled();
    expect(onOpenShortcuts).not.toHaveBeenCalled();
    expect(prevented).toBe(false);
  });
});

describe("useKeyboardMap — THE FENCE (inert in every typing context)", () => {
  const typingTargets: Array<[string, string]> = [
    ["a text input", "text-input"],
    ["a textarea", "text-area"],
    ["a contenteditable", "ce"],
    ["the embedded terminal host", "embedded-terminal"],
    ["the xterm helper textarea", "embedded-terminal-canvas"],
    ["an open dialog input", "dialog-input"],
  ];

  for (const [name, testid] of typingTargets) {
    it(`does NOT fire '?' or Ctrl+K from ${name}, and does not preventDefault`, () => {
      const el =
        document.querySelector(`[data-testid="${testid}"]`) ??
        (testid === "embedded-terminal-canvas"
          ? document.querySelector(".xterm-helper-textarea")
          : null);
      expect(el).toBeTruthy();
      const q = dispatch(el as Element, { key: "?" });
      const k = dispatch(el as Element, { key: "k", ctrlKey: true });
      expect(onOpenShortcuts).not.toHaveBeenCalled();
      expect(onOpenPalette).not.toHaveBeenCalled();
      expect(q.prevented).toBe(false);
      expect(k.prevented).toBe(false);
    });
  }

  it("is inert during IME composition (isComposing)", () => {
    dispatch(document.body, { key: "?", isComposing: true });
    dispatch(document.body, { key: "k", ctrlKey: true, isComposing: true });
    expect(onOpenShortcuts).not.toHaveBeenCalled();
    expect(onOpenPalette).not.toHaveBeenCalled();
  });
});

describe("isTypingContext predicate", () => {
  it("classifies inputs / terminal / dialogs as typing contexts", () => {
    for (const testid of [
      "text-input",
      "text-area",
      "ce",
      "embedded-terminal",
      "dialog-input",
    ]) {
      const el = document.querySelector(`[data-testid="${testid}"]`);
      expect(isTypingContext(el)).toBe(true);
    }
  });

  it("classifies document.body as NOT a typing context", () => {
    expect(isTypingContext(document.body)).toBe(false);
  });

  it("treats the xterm helper textarea as a typing context", () => {
    const el = document.querySelector(".xterm-helper-textarea");
    expect(isTypingContext(el)).toBe(true);
  });
});
