/*
 * terminal-osc52 — relay Claude's OSC 52 clipboard writes to the OS clipboard
 * (iterate-2026-07-07-terminal-osc52-clipboard).
 *
 * Claude Code copies a mouse selection via **OSC 52** — the terminal escape
 * `ESC ] 52 ; c ; <base64> BEL`. xterm.js drops OSC 52 by default (a program
 * writing your clipboard is a known injection vector), so the copy never
 * reached the OS clipboard: Claude showed "copied N chars to clipboard" but a
 * paste returned the OLD entry. This registers a `parser.registerOscHandler(52)`
 * callback that decodes the payload and writes it via `lib/clipboard` `copyText`
 * — whose `execCommand` fallback works in the non-secure http/Tailscale context
 * where `navigator.clipboard` is absent.
 *
 * Security posture — **WRITE only**:
 *   - A WRITE (`52;c;<base64>`) is relayed to the clipboard.
 *   - A READ request (`52;c;?`) is DENIED (consumed, no reply) so the terminal
 *     never leaks the OS clipboard back to a program.
 *   - Oversized payloads are rejected (DoS guard); an empty write is a no-op
 *     (we never silently CLEAR the user's clipboard).
 */

/** Max decoded clipboard chars accepted from one OSC 52 write (DoS guard). */
export const OSC52_MAX_BYTES = 1_000_000;

export interface Osc52Parsed {
  kind: "write" | "read" | "invalid";
  /** Present only for `kind: "write"`. */
  text?: string;
}

/**
 * UTF-8-safe base64 decode. Returns `null` on malformed input. Mirrors the
 * `btoa(unescape(encodeURIComponent(s)))` encoder Claude/most terminals use.
 */
export function decodeOsc52Base64(b64: string): string | null {
  if (typeof atob !== "function") return null;
  try {
    const bin = atob(b64.trim());
    try {
      // Re-interpret the binary string's bytes as UTF-8.
      return decodeURIComponent(
        Array.from(bin)
          .map((c) => "%" + c.charCodeAt(0).toString(16).padStart(2, "0"))
          .join(""),
      );
    } catch {
      // Not valid UTF-8 — hand back the raw byte string unchanged.
      return bin;
    }
  } catch {
    return null;
  }
}

/**
 * Parse an OSC 52 payload (`<Pc>;<Pd>`). `Pd === "?"` is a READ request. `Pc`
 * (the clipboard selector: c/p/q/s/0-7) is intentionally ignored — we always
 * target the system clipboard.
 */
export function parseOsc52(data: string): Osc52Parsed {
  const semi = data.indexOf(";");
  const pd = semi >= 0 ? data.slice(semi + 1) : data;
  if (pd === "?") return { kind: "read" };
  // Cheap length pre-check BEFORE decoding: base64 is ~4/3 of the decoded
  // size, so any payload longer than that ceiling can't fit the cap — reject
  // it without the (potentially large) `atob` + `%XX` allocation.
  if (pd.length > Math.ceil((OSC52_MAX_BYTES * 4) / 3) + 4) {
    return { kind: "invalid" };
  }
  const text = decodeOsc52Base64(pd);
  if (text === null) return { kind: "invalid" };
  if (text.length > OSC52_MAX_BYTES) return { kind: "invalid" };
  return { kind: "write", text };
}

export interface Osc52HandlerDeps {
  /** Write text to the OS clipboard (lib/clipboard.copyText — execCommand fallback). */
  copy: (text: string) => Promise<void>;
  /** True once the terminal is disposed; async tails then no-op. */
  isDisposed?: () => boolean;
  /** Surface a failed clipboard write (e.g. a transient corner pill). */
  onError?: () => void;
}

/**
 * Build the OSC 52 handler for `term.parser.registerOscHandler(52, ...)`. It
 * ALWAYS returns `true` — we consume every OSC 52 (a write is relayed, a read
 * is denied, garbage is swallowed) so xterm does nothing further with it.
 */
export function createOsc52ClipboardHandler(
  deps: Osc52HandlerDeps,
): (data: string) => boolean {
  const { copy, isDisposed, onError } = deps;
  return (data: string): boolean => {
    const parsed = parseOsc52(data);
    // Only a non-empty write touches the clipboard. Read → denied; empty write
    // → no clobber; invalid → swallowed.
    if (parsed.kind === "write" && parsed.text) {
      void copy(parsed.text).catch(() => {
        if (isDisposed?.()) return;
        onError?.();
      });
    }
    return true;
  };
}
