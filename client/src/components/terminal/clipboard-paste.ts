/*
 * Clipboard-paste decoding helpers (iterate v0.8.3 AC-1).
 *
 * v0.8.2 moved our DOM `paste` listener to `document` capture-phase, but
 * real-browser Ctrl+V still didn't reach our handler — xterm.js's Ctrl+V
 * keybinding bypasses ClipboardEvent entirely and uses the async
 * `navigator.clipboard.readText()` API. That call resolves to text only,
 * which is why image-paste from a bare PowerShell prompt landed nowhere.
 *
 * The fix is two-stage:
 *
 *   1. Suppress xterm's default Ctrl+V handling via `attachCustomKeyEventHandler`
 *      so the browser's own paste pipeline doesn't fire on the focused
 *      textarea (Windows OS strips images from textarea-targeted pastes).
 *   2. On the suppressed Ctrl+V keydown, drive `navigator.clipboard.read()`
 *      (full ClipboardItem array, types include "image/*") and route through
 *      the same upload path as the existing <paste>-event handler, falling
 *      back to text when no image is present.
 *
 * This module exports the two pure pieces so they can be tested in
 * isolation: `shouldInterceptCtrlV` (synchronous decision, used inside
 * `attachCustomKeyEventHandler`) and `readClipboardForPaste` (async
 * decoder, returns a discriminated union the caller maps to upload vs
 * socket.send).
 */

export function shouldInterceptCtrlV(ev: KeyboardEvent): boolean {
  // Only handle the "down" half of the keystroke — keyup/keypress would
  // re-fire the handler twice and the second clipboard.read() would
  // resolve against an already-consumed payload (or violate the
  // user-gesture invariant on Chrome/Edge).
  if (ev.type !== "keydown") return false;
  if (!ev.ctrlKey) return false;
  if (ev.altKey || ev.shiftKey || ev.metaKey) return false;
  // `key` is locale-aware (German keyboard reports "v" for the V key);
  // codepoint check via toLowerCase keeps it Layout-agnostic.
  return ev.key.toLowerCase() === "v";
}

export type ClipboardPastePayload =
  | { kind: "image"; blob: Blob; filename: string; mimeType: string }
  | { kind: "text"; text: string }
  | { kind: "empty" }
  | { kind: "unsupported"; reason: string }
  | { kind: "error"; detail: string };

interface ClipboardReadCapable {
  clipboard?: {
    read?: () => Promise<ReadonlyArray<ClipboardItem>>;
  };
}

/**
 * Walks `navigator.clipboard.read()` items and decodes the first
 * usable payload, with image-wins precedence (matches the existing
 * <paste>-event handler in EmbeddedTerminal). Returns a discriminated
 * union so the caller decides where to route each kind.
 *
 * Browsers without `clipboard.read` (notably Firefox for non-text
 * payloads as of writing) return `unsupported` so the caller can
 * surface a toast and fall through to xterm's text-only path. Not a
 * thrown error — that channel is reserved for transient runtime
 * failures (DOMException etc.) the caller should report verbatim.
 */
export async function readClipboardForPaste(
  nav: ClipboardReadCapable,
): Promise<ClipboardPastePayload> {
  const reader = nav.clipboard?.read;
  if (typeof reader !== "function") {
    return { kind: "unsupported", reason: "navigator.clipboard.read unavailable" };
  }
  let items: ReadonlyArray<ClipboardItem>;
  try {
    items = await reader.call(nav.clipboard);
  } catch (err) {
    return {
      kind: "error",
      detail: err instanceof Error ? err.message : String(err),
    };
  }
  if (!items || items.length === 0) return { kind: "empty" };

  // Image-wins precedence — first ClipboardItem that exposes any image/*
  // type is uploaded; text on the same item (or other items) is dropped.
  for (const item of items) {
    const imageType = item.types.find((t) => t.startsWith("image/"));
    if (imageType) {
      try {
        const blob = await item.getType(imageType);
        const ext = imageType.split("/")[1] ?? "png";
        return {
          kind: "image",
          blob,
          filename: `paste-${Date.now()}.${ext}`,
          mimeType: imageType,
        };
      } catch (err) {
        return {
          kind: "error",
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    }
  }

  // No image anywhere — extract the first text payload we find.
  for (const item of items) {
    if (item.types.includes("text/plain")) {
      try {
        const blob = await item.getType("text/plain");
        const text = await readBlobAsText(blob);
        // Empty-text fall-through stays in the `text` arm — caller
        // decides whether to suppress empty payloads or send them as a
        // bare carriage-return (it shouldn't, but the policy lives in
        // the caller, not here).
        return { kind: "text", text };
      } catch (err) {
        return {
          kind: "error",
          detail: err instanceof Error ? err.message : String(err),
        };
      }
    }
  }

  return { kind: "empty" };
}

// jsdom does NOT implement `Blob.prototype.text()` (documented in
// `.shipwright/agent_docs/conventions.md` § Learnings). Real browsers
// have it since 2020. Tiny FileReader polyfill keeps both paths working
// without forcing the test to fake the production decoder API.
async function readBlobAsText(blob: Blob): Promise<string> {
  if (typeof blob.text === "function") {
    return blob.text();
  }
  if (typeof FileReader === "undefined") {
    throw new Error("Blob.text() and FileReader both unavailable");
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () =>
      reject(reader.error ?? new Error("FileReader failed"));
    reader.readAsText(blob);
  });
}
