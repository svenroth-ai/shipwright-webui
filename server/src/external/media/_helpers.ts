/*
 * external/media/_helpers.ts — video MIME allowlist + HTTP Range parser
 * for the streaming media route (iterate-2026-06-03-smartviewer-video-view).
 *
 * Kept separate from file/_helpers.ts so the deliberately-atomic /file
 * route (5 MB cap, readFileSync, documented race-avoidance) stays
 * untouched. The /media route streams via createReadStream + Range, which
 * is a different invariant set.
 */

/**
 * Explicit extension → Content-Type mapping for browser-playable video
 * containers. Any extension NOT in this table is rejected with 415 by the
 * media route — we never infer a media type from bytes.
 *
 * We serve the container as-is; whether the browser can decode the codec
 * inside is the browser's call (an undecodable codec surfaces via the
 * <video> element's own error → the client's fallback chip).
 */
export const VIDEO_MIME_BY_EXTENSION: Record<string, string> = Object.freeze({
  mp4: "video/mp4",
  m4v: "video/x-m4v",
  webm: "video/webm",
  ogv: "video/ogg",
  ogg: "video/ogg",
  mov: "video/quicktime",
});

export type ParsedRange =
  | { kind: "none" }
  | { kind: "ok"; start: number; end: number }
  | { kind: "unsatisfiable" };

/**
 * Parse a single-range `Range: bytes=start-end` header against a known
 * file size. Multi-range (comma-separated) requests are intentionally NOT
 * honoured — we treat them as "none" and serve the full body, which is a
 * spec-legal response (a server MAY ignore Range).
 *
 * Returns:
 *   - `none`           — no header / malformed / empty-both / multi-range
 *   - `ok{start,end}`  — inclusive byte bounds, end clamped to size-1
 *   - `unsatisfiable`  — start beyond EOF, or start > end → caller emits 416
 */
export function parseRangeHeader(
  header: string | undefined | null,
  size: number,
): ParsedRange {
  if (!header) return { kind: "none" };
  // The `\d*` capture groups accept digits only — a sign character ('-' in a
  // negative number) is never captured, so `Number(startStr)`/`Number(endStr)`
  // can never be negative. A leading-minus payload like `bytes=-1-5` fails to
  // match the whole-string anchor → treated as malformed (`none`) → full body.
  const m = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!m) return { kind: "none" };

  const startStr = m[1];
  const endStr = m[2];
  if (startStr === "" && endStr === "") return { kind: "none" };

  let start: number;
  let end: number;

  if (startStr === "") {
    // Suffix range: last N bytes.
    const suffix = Number(endStr);
    if (!Number.isFinite(suffix) || suffix <= 0) return { kind: "unsatisfiable" };
    if (size === 0) return { kind: "unsatisfiable" };
    start = suffix >= size ? 0 : size - suffix;
    end = size - 1;
    return { kind: "ok", start, end };
  }

  start = Number(startStr);
  end = endStr === "" ? size - 1 : Number(endStr);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return { kind: "none" };
  if (start > end) return { kind: "unsatisfiable" };
  if (start >= size) return { kind: "unsatisfiable" };
  if (end >= size) end = size - 1;
  return { kind: "ok", start, end };
}
