/*
 * terminal-clipboard — PASTE chord handling for the embedded xterm.
 *
 * iterate-2026-05-18-terminal-copy-paste (paste fidelity). COPY handling was
 * REMOVED in iterate-2026-07-07-terminal-osc52-clipboard: Claude Code copies
 * its own mouse selection via OSC 52 and the WebUI relays it to the OS
 * clipboard (see terminal-osc52.ts), so the WebUI no longer intercepts Ctrl+C /
 * Ctrl+Insert. Ctrl+C now ALWAYS passes through to the pty (SIGINT / Claude's
 * own interrupt) — the correct behaviour inside Claude, where the old copy
 * interception could swallow a real interrupt when a selection existed.
 *
 * Paste chords = VS Code Windows-terminal parity: Ctrl+V / Shift+Insert.
 * xterm's built-in Ctrl+V fails silently in a non-secure context (the WebUI
 * reached over the Tailscale IP — plain http — where `navigator.clipboard` is
 * unavailable); this handler surfaces an inline "use right-click → Paste" hint
 * instead of failing silently. `Meta+*` (macOS) and `Alt+*` (Claude TUI's
 * Alt+V image-paste) are always passthrough.
 */

import type { Terminal } from "@xterm/xterm";

export type ClipboardChord = "paste" | "passthrough";

/**
 * Subset of `KeyboardEvent` the classifier reads. Declared as an interface so
 * the classifier is unit-testable without a DOM event.
 */
export interface ChordEventLike {
  type: string;
  ctrlKey: boolean;
  shiftKey: boolean;
  metaKey: boolean;
  altKey: boolean;
  key: string;
}

/**
 * Map a keyboard event to a clipboard intent. Pure — `keydown` only. Only
 * PASTE is intercepted; every other key (including Ctrl+C / Ctrl+Insert) is
 * `passthrough` so it reaches the pty. Uses the semantic `ev.key` so the intent
 * follows the character the user's layout produces.
 */
export function classifyClipboardChord(ev: ChordEventLike): ClipboardChord {
  if (ev.type !== "keydown") return "passthrough";
  // macOS Cmd+* and Alt+* are never our chords — let the browser / Claude TUI
  // handle them (Cmd+V fires a native `paste` event).
  if (ev.metaKey || ev.altKey) return "passthrough";

  const key = ev.key.toLowerCase();
  const isInsert = ev.key === "Insert";

  // Paste — Ctrl+V, or Shift+Insert (Ctrl excluded so Ctrl+Shift+Insert is not
  // a paste either).
  if (ev.ctrlKey && !ev.shiftKey && key === "v") return "paste";
  if (ev.shiftKey && !ev.ctrlKey && isInsert) return "paste";

  return "passthrough";
}

/** Outcome of a clipboard read for a paste. */
export type PasteRead =
  | { ok: true; text: string }
  | { ok: false; reason: "unavailable" | "denied" };

/**
 * Read the OS clipboard for a paste.
 *
 * - `unavailable` — the async Clipboard API is absent. This is the
 *   non-secure-context case (the WebUI over Tailscale http): the caller shows
 *   the "use right-click → Paste" hint.
 * - `denied` — `readText()` rejected: the caller shows a "Paste failed" notice.
 */
export async function readClipboardForPaste(): Promise<PasteRead> {
  if (
    typeof navigator === "undefined" ||
    !navigator.clipboard ||
    typeof navigator.clipboard.readText !== "function"
  ) {
    return { ok: false, reason: "unavailable" };
  }
  try {
    const text = await navigator.clipboard.readText();
    return { ok: true, text };
  } catch {
    return { ok: false, reason: "denied" };
  }
}

/** Kind of transient notice the clipboard surfaces (corner pill). */
export type ClipboardNoticeKind = "copy-failed" | "paste-hint" | "paste-failed";

/** xterm surface the paste handler needs — kept minimal for test fakes. */
export type ClipboardTerminal = Pick<Terminal, "paste">;

export interface ClipboardKeyHandlerDeps {
  /** The xterm terminal — paste sink. */
  term: ClipboardTerminal;
  /** True once the terminal is disposed; async callbacks then no-op. */
  isDisposed: () => boolean;
  /** Surface a transient notice (corner pill). */
  notify: (kind: ClipboardNoticeKind) => void;
  /** Read the OS clipboard (readClipboardForPaste). */
  readClipboard: () => Promise<PasteRead>;
}

/**
 * Build the `attachCustomKeyEventHandler` callback for the embedded terminal.
 * Returns `true` to let xterm process the key, `false` to suppress it.
 *
 * Paste (Ctrl+V / Shift+Insert):
 *  - always `preventDefault` + `stopPropagation`: both chords ALSO fire a
 *    native browser `paste` event → without this the text lands twice.
 *  - read the clipboard → `term.paste()` (line-ending + bracketed-paste
 *    normalization); `unavailable` → "paste-hint"; `denied` → "paste-failed".
 *  - held chord → suppress, no re-paste.
 *
 * Every other key — including Ctrl+C / Ctrl+Insert — passes through to the pty.
 */
export function createClipboardKeyHandler(
  deps: ClipboardKeyHandlerDeps,
): (ev: KeyboardEvent) => boolean {
  const { term, isDisposed, notify, readClipboard } = deps;

  return (ev: KeyboardEvent): boolean => {
    if (classifyClipboardChord(ev) !== "paste") return true;

    // Suppress xterm's default AND the native `paste` event that Ctrl+V /
    // Shift+Insert also fire — otherwise the pasted text lands twice.
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.repeat) return false; // held chord — pasted once already
    void readClipboard().then((result) => {
      if (isDisposed()) return;
      if (result.ok) {
        // term.paste() normalizes line endings + wraps the text in
        // bracketed-paste markers when the app enabled them, so a multi-line
        // prompt pastes intact instead of submitting on its first line.
        if (result.text) term.paste(result.text);
      } else if (result.reason === "unavailable") {
        notify("paste-hint");
      } else {
        notify("paste-failed");
      }
    });
    return false;
  };
}
