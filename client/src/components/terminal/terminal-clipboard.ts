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
 * instead of failing silently. `Meta+*` (macOS) is always passthrough.
 *
 * IMAGES (iterate-2026-10-10-terminal-image-paste-keyboard): Ctrl+V used to read
 * TEXT only and preventDefault the native `paste` event, so an image on the
 * clipboard was dropped (only right-click -> Paste, whose native event carries
 * the image, worked). Ctrl+V now reads the async clipboard for an image first
 * and hands it to the same upload route as the native path. Alt+V (Claude TUI's
 * image-paste chord) is intercepted for the same reason: Claude would read the
 * SERVER's OS clipboard, which is empty when the WebUI is used from a remote
 * machine. With no image on the browser clipboard it forwards the chord to the
 * pty, so local use is unchanged.
 */

import type { Terminal } from "@xterm/xterm";

export type ClipboardChord = "paste" | "paste-image" | "passthrough";

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
  if (ev.metaKey) return "passthrough";

  // Alt+V - Claude TUI's image-paste chord; handled client-side (see header).
  if (ev.altKey) {
    // Semantic key only: macOS Option+V yields "√" and stays passthrough.
    const isV = ev.key.toLowerCase() === "v";
    return isV && !ev.ctrlKey && !ev.shiftKey ? "paste-image" : "passthrough";
  }

  const key = ev.key.toLowerCase();
  const isInsert = ev.key === "Insert";

  // Paste — Ctrl+V, or Shift+Insert (Ctrl excluded so Ctrl+Shift+Insert is not
  // a paste either).
  if (ev.ctrlKey && !ev.shiftKey && key === "v") return "paste";
  if (ev.shiftKey && !ev.ctrlKey && isInsert) return "paste";

  return "passthrough";
}

/** Outcome of a clipboard read for a paste. An image wins over text. */
export type PasteRead =
  | { ok: true; text: string; image?: undefined }
  | { ok: true; image: Blob; text?: undefined }
  | { ok: false; reason: "unavailable" | "denied" };

/** `navigator.clipboard.read()` items, or null (absent / denied / failed). */
async function readClipboardItems(): Promise<ClipboardItems | null> {
  if (
    typeof navigator === "undefined" ||
    !navigator.clipboard ||
    typeof navigator.clipboard.read !== "function"
  ) {
    return null;
  }
  try {
    return await navigator.clipboard.read();
  } catch {
    return null;
  }
}

async function firstImage(items: ClipboardItems): Promise<Blob | null> {
  for (const item of items) {
    const type = item.types.find((t) => t.startsWith("image/"));
    if (!type) continue;
    try {
      return await item.getType(type);
    } catch {
      /* try the next item */
    }
  }
  return null;
}

/**
 * First image on the browser clipboard, or null (no async `read()`, permission
 * denied, or no image item). Never throws - callers fall back to passthrough.
 */
export async function readClipboardImage(): Promise<Blob | null> {
  const items = await readClipboardItems();
  return items ? firstImage(items) : null;
}

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
  // ONE async read for image + text: Safari/Firefox gate every clipboard read
  // on a user gesture, so read() followed by readText() could lose the gesture.
  const items = await readClipboardItems();
  if (items) {
    const image = await firstImage(items);
    if (image) return { ok: true, image };
    for (const item of items) {
      if (!item.types.includes("text/plain")) continue;
      try {
        return { ok: true, text: await (await item.getType("text/plain")).text() };
      } catch {
        /* fall through to readText */
      }
    }
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
export type ClipboardTerminal = Pick<Terminal, "paste" | "input">;

export interface ClipboardKeyHandlerDeps {
  /** The xterm terminal — paste sink. */
  term: ClipboardTerminal;
  /** True once the terminal is disposed; async callbacks then no-op. */
  isDisposed: () => boolean;
  /** Surface a transient notice (corner pill). */
  notify: (kind: ClipboardNoticeKind) => void;
  /** Read the OS clipboard (readClipboardForPaste). */
  readClipboard: () => Promise<PasteRead>;
  /** Read only an image off the clipboard (Alt+V). */
  readImage: () => Promise<Blob | null>;
  /** Upload a clipboard image (same route as the native paste event). */
  uploadImage: (blob: Blob) => void;
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
 * Image paste: Ctrl+V / Shift+Insert upload an image found on the clipboard
 * (instead of pasting text); Alt+V uploads an image or, when there is none,
 * forwards ESC v to the pty so Claude's own chord still works locally.
 *
 * Every other key — including Ctrl+C / Ctrl+Insert — passes through to the pty.
 */
export function createClipboardKeyHandler(
  deps: ClipboardKeyHandlerDeps,
): (ev: KeyboardEvent) => boolean {
  const { term, isDisposed, notify, readClipboard, readImage, uploadImage } =
    deps;

  return (ev: KeyboardEvent): boolean => {
    const chord = classifyClipboardChord(ev);
    if (chord === "passthrough") return true;

    if (chord === "paste-image") {
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.repeat) return false;
      void readImage().then((image) => {
        if (isDisposed()) return;
        if (image) uploadImage(image);
        else term.input("\x1bv", true); // no browser image: forward Alt+V to the pty
      });
      return false;
    }

    // Suppress xterm's default AND the native `paste` event that Ctrl+V /
    // Shift+Insert also fire — otherwise the pasted text lands twice.
    ev.preventDefault();
    ev.stopPropagation();
    if (ev.repeat) return false; // held chord — pasted once already
    void readClipboard().then((result) => {
      if (isDisposed()) return;
      if (result.ok) {
        if (result.image) {
          uploadImage(result.image);
          return;
        }
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

/**
 * Touch paste (key-bar "Paste" button). iOS offers no long-press paste menu on
 * the terminal surface, so a TAP — the user gesture `navigator.clipboard.read*`
 * demands — is the paste path there. Same read + routing as the Ctrl+V chord:
 * an image uploads, text goes through `term.paste` (bracketed-paste aware).
 */
export async function pasteFromClipboardTap(deps: {
  term: Pick<Terminal, "paste"> | null;
  writer: boolean;
  isDisposed: () => boolean;
  notify: (kind: ClipboardNoticeKind) => void;
  uploadImage: (image: Blob) => void;
}): Promise<void> {
  if (!deps.writer || !deps.term) return;
  const r = await readClipboardForPaste();
  if (deps.isDisposed()) return;
  if (!r.ok) return deps.notify(r.reason === "unavailable" ? "paste-hint" : "paste-failed");
  try {
    if (r.image) deps.uploadImage(r.image);
    else if (r.text) deps.term.paste(r.text);
  } catch {
    deps.notify("paste-failed");
  }
}
