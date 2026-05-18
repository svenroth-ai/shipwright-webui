/*
 * Terminal clipboard helpers — copy/paste for the embedded xterm.
 *
 * iterate-2026-05-18-terminal-copy-paste. xterm.js ships no text-copy
 * binding and its built-in Ctrl+V fails silently in a non-secure context
 * (the WebUI is reached over the Tailscale IP — plain http — where
 * `navigator.clipboard` is unavailable). `EmbeddedTerminal` registers the
 * handler from `createClipboardKeyHandler` via `attachCustomKeyEventHandler`.
 *
 * Chord set = VS Code Windows-terminal parity: Ctrl+C / Ctrl+Insert copy,
 * Ctrl+V / Shift+Insert paste. `Ctrl+Shift+C` is deliberately NOT a copy
 * chord — it is Chrome's DevTools "inspect" accelerator and is not
 * reliably interceptable from a browser tab. `Meta+*` (macOS) and `Alt+*`
 * (Claude TUI's Alt+V image-paste) are always passthrough so the browser
 * / Claude handle them natively.
 *
 * The logic here is renderer-free + DOM-event-free at its core (the pure
 * classifier) and dependency-injected at its edge (the handler factory),
 * so both are unit-testable without mounting xterm.
 */

import type { Terminal } from "@xterm/xterm";

export type ClipboardChord = "copy" | "paste" | "passthrough";

/**
 * Subset of `KeyboardEvent` the classifier reads. Declared as an
 * interface so the classifier is unit-testable without a DOM event.
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
 * Map a keyboard event to a clipboard intent. Pure — `keydown` only;
 * `keyup` / `keypress` and every non-clipboard key are `passthrough`.
 * Uses the semantic `ev.key` (not `ev.code`) so the intent follows the
 * character the user's layout produces, per external review.
 */
export function classifyClipboardChord(ev: ChordEventLike): ClipboardChord {
  if (ev.type !== "keydown") return "passthrough";
  // macOS Cmd+* and Alt+* are never our chords — let the browser /
  // Claude TUI handle them (Cmd+V fires a native `paste` event).
  if (ev.metaKey || ev.altKey) return "passthrough";

  const key = ev.key.toLowerCase();
  const isInsert = ev.key === "Insert";

  // Copy — Ctrl+C / Ctrl+Insert. Shift excluded so Ctrl+Shift+C and
  // Ctrl+Shift+Insert fall through to passthrough.
  if (ev.ctrlKey && !ev.shiftKey && (key === "c" || isInsert)) {
    return "copy";
  }
  // Paste — Ctrl+V, or Shift+Insert (Ctrl excluded so Ctrl+Shift+Insert
  // is not a paste either).
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
 *   non-secure-context case (the WebUI over Tailscale http): the caller
 *   shows the "use right-click → Paste" hint.
 * - `denied` — `readText()` rejected (permission denied / browser-level
 *   failure): the caller shows a "Paste failed" notice — never silent.
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

/** Kind of transient notice the copy/paste handler surfaces. */
export type ClipboardNoticeKind =
  | "copied"
  | "copy-failed"
  | "paste-hint"
  | "paste-failed";

/** xterm surface the key handler needs — kept minimal for test fakes. */
export type ClipboardTerminal = Pick<
  Terminal,
  "hasSelection" | "getSelection" | "clearSelection" | "paste"
>;

export interface ClipboardKeyHandlerDeps {
  /** The xterm terminal — selection source + paste sink. */
  term: ClipboardTerminal;
  /** True once the terminal is disposed; async callbacks then no-op. */
  isDisposed: () => boolean;
  /** Surface a transient notice (corner pill). */
  notify: (kind: ClipboardNoticeKind) => void;
  /** Copy text to the OS clipboard (lib/clipboard.copyText). Rejects on failure. */
  copy: (text: string) => Promise<void>;
  /** Read the OS clipboard (readClipboardForPaste). */
  readClipboard: () => Promise<PasteRead>;
}

/**
 * Build the `attachCustomKeyEventHandler` callback for the embedded
 * terminal. Returns `true` to let xterm process the key, `false` to
 * suppress it.
 *
 * Copy (Ctrl+C / Ctrl+Insert):
 *  - non-empty selection → `preventDefault` (suppress the native `copy`
 *    event), copy, clear the selection ON SUCCESS ONLY (preserved on
 *    failure so the user can retry), notify.
 *  - empty / whitespace-only selection → passthrough: Ctrl+C reaches the
 *    pty as SIGINT, Ctrl+Insert reaches an app that binds it.
 *  - held chord (`ev.repeat`) with a selection → suppress, no re-copy.
 *
 * Paste (Ctrl+V / Shift+Insert):
 *  - always `preventDefault` + `stopPropagation`: both chords ALSO fire
 *    a native browser `paste` event → without this the text lands twice.
 *  - read the clipboard → `term.paste()` (line-ending + bracketed-paste
 *    normalization); `unavailable` → "paste-hint"; `denied` →
 *    "paste-failed".
 *  - held chord → suppress, no re-paste.
 */
export function createClipboardKeyHandler(
  deps: ClipboardKeyHandlerDeps,
): (ev: KeyboardEvent) => boolean {
  const { term, isDisposed, notify, copy, readClipboard } = deps;

  return (ev: KeyboardEvent): boolean => {
    const intent = classifyClipboardChord(ev);
    if (intent === "passthrough") return true;

    if (intent === "copy") {
      const selection = term.hasSelection() ? term.getSelection() : "";
      // Empty / whitespace-only selection → let the key through:
      // Ctrl+C becomes SIGINT, Ctrl+Insert reaches the foreground app.
      if (selection.trim().length === 0) return true;
      // Suppress xterm's default AND the browser's native `copy` event.
      ev.preventDefault();
      ev.stopPropagation();
      // Held chord — the first keydown already copied this selection.
      if (ev.repeat) return false;
      void copy(selection).then(
        () => {
          if (isDisposed()) return;
          // Clear ONLY on success — a failed copy keeps the selection so
          // the user can retry or fall back to right-click → Copy.
          term.clearSelection();
          notify("copied");
        },
        () => {
          if (isDisposed()) return;
          notify("copy-failed");
        },
      );
      return false;
    }

    // intent === "paste"
    // Suppress xterm's default AND the native `paste` event that Ctrl+V /
    // Shift+Insert also fire — otherwise the pasted text lands twice.
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.repeat) return false; // held chord — pasted once already
    void readClipboard().then((result) => {
      if (isDisposed()) return;
      if (result.ok) {
        // term.paste() normalizes line endings + wraps the text in
        // bracketed-paste markers when the app enabled them, so a
        // multi-line prompt pastes intact instead of submitting on its
        // first line.
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
