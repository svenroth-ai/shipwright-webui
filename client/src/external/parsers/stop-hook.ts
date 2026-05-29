/*
 * Stop-hook fingerprint detector — iterate-2026-05-27-transcript-renderer-scroll AC3.
 *
 * Claude Code injects Stop-hook output as a user-role event whose
 * content is a plain string starting with `"Stop hook feedback:\n=...
 * \n  SHIPWRIGHT <GATE> ...\n=...\n<body>"`. We reclassify these
 * fingerprint matches to `kind: "stop-hook"` so the renderer can
 * show a collapsed Tool-call-style card instead of a right-aligned
 * user bubble showing the full ASCII-art banner.
 *
 * Design decisions (locked by external-review on the iterate plan):
 *
 *   - String-only `content`. All 12/12 observations in the sample
 *     session (sessionId 86832cb1) carry string content. Array-block
 *     drift is forward-compat: the detector returns null and the
 *     event falls through to plain `user` (no swallowing).
 *
 *   - `startsWith("Stop hook feedback:")` as the primary gate
 *     (string-start), NOT a `/m`-flagged regex (line-start). The
 *     `/m` design was falsified by external review HIGH-2: it would
 *     let mixed prose like `"Hey:\nStop hook feedback:\n=..."`
 *     match and swallow the prefix prose. The startsWith check
 *     guarantees that R1 (no false-positive on quoted-mention) holds.
 *
 *   - Length guard (16 KiB). Real banners observed in the wild are
 *     a few KiB; pathological inputs are rejected to keep the regex
 *     from doing megabyte-scale work.
 *
 *   - Sanity floor (30 chars). The shortest valid banner has
 *     `"Stop hook feedback:\n====\n  X\n====\n"` ≈ 30 chars.
 *
 *   - When the prefix matches but the banner shape is malformed
 *     (no `===` lines, missing title), we STILL classify as
 *     `stop-hook` with a default `gateName: "Stop hook"`. Returning
 *     null in that branch would leak the stop-hook output back into
 *     a plain user bubble — that's a worse failure mode than a
 *     generic title.
 */

const MAX_LEN = 16384;
const MIN_LEN = 30;
const PREFIX = "Stop hook feedback:";

// No `/m` flag: `^` matches string-start only. Captures the banner
// title between two `=`-lines. `.+?` is lazy so the FIRST closing
// `=`-line wins (some payloads have additional `===` separators
// further down inside the body).
const BANNER_REGEX = /^Stop hook feedback:\s*\n=+\s*\n\s*(.+?)\n=+\s*\n/;

export interface StopHookDetection {
  gateName: string;
  body: string;
}

export function detectStopHook(content: unknown): StopHookDetection | null {
  if (typeof content !== "string") return null;
  if (content.length < MIN_LEN) return null;
  if (content.length > MAX_LEN) return null;
  if (!content.startsWith(PREFIX)) return null;
  const match = content.match(BANNER_REGEX);
  if (!match) {
    // Prefix present but banner shape drifted — still classify as
    // stop-hook with a default title. We never want to fall through
    // to plain `user` once the prefix has matched.
    return { gateName: "Stop hook", body: content };
  }
  const captured = match[1].trim();
  return {
    gateName: captured.length > 0 ? captured : "Stop hook",
    body: content,
  };
}
