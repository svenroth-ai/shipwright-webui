/*
 * external/file/_helpers.ts — file-route constants + Content-Disposition
 * filename sanitization, extracted from the historical routes.ts. The
 * shell (../routes.ts) re-exports these for back-compat with the 14
 * sibling test files that imported `FILE_MAX_BYTES`, `MIME_BY_EXTENSION`,
 * and `sanitizeContentDispositionFilename` from `./routes.js`.
 */

import { basename } from "node:path";

/** 5 MB — server-side cap per spec. Client applies a lower 1 MB cap for
 * text/markdown/code; images may use the full 5 MB budget. */
export const FILE_MAX_BYTES = 5 * 1024 * 1024;

/**
 * Explicit extension → Content-Type mapping. Any extension NOT in this table
 * is treated as "not previewable" and rejected with 415 from the file route.
 *
 * Security rationale:
 *   - Everything text-ish is served as text/plain (NOT application/javascript
 *     or text/typescript) so the browser can't be tricked into executing it
 *     even in a renderable-script context.
 *   - Markdown is served as text/markdown; charset=utf-8 — some browsers
 *     render it inline, but the nosniff header + Content-Disposition inline
 *     with explicit filename prevents auto-download shenanigans.
 *   - Image entries match the documented allowlist (png / jpg / jpeg / gif /
 *     svg / webp).
 */
export const MIME_BY_EXTENSION: Record<string, string> = Object.freeze({
  // Text-ish — all served as text/plain regardless of semantic type.
  txt: "text/plain; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  markdown: "text/markdown; charset=utf-8",
  log: "text/plain; charset=utf-8",
  json: "text/plain; charset=utf-8",
  yaml: "text/plain; charset=utf-8",
  yml: "text/plain; charset=utf-8",
  toml: "text/plain; charset=utf-8",
  csv: "text/plain; charset=utf-8",
  xml: "text/plain; charset=utf-8",
  html: "text/plain; charset=utf-8",
  css: "text/plain; charset=utf-8",
  js: "text/plain; charset=utf-8",
  jsx: "text/plain; charset=utf-8",
  ts: "text/plain; charset=utf-8",
  tsx: "text/plain; charset=utf-8",
  mjs: "text/plain; charset=utf-8",
  cjs: "text/plain; charset=utf-8",
  sh: "text/plain; charset=utf-8",
  bash: "text/plain; charset=utf-8",
  zsh: "text/plain; charset=utf-8",
  py: "text/plain; charset=utf-8",
  rb: "text/plain; charset=utf-8",
  go: "text/plain; charset=utf-8",
  rs: "text/plain; charset=utf-8",
  java: "text/plain; charset=utf-8",
  kt: "text/plain; charset=utf-8",
  swift: "text/plain; charset=utf-8",
  c: "text/plain; charset=utf-8",
  h: "text/plain; charset=utf-8",
  cpp: "text/plain; charset=utf-8",
  hpp: "text/plain; charset=utf-8",
  sql: "text/plain; charset=utf-8",
  env: "text/plain; charset=utf-8",
  gitignore: "text/plain; charset=utf-8",
  dockerfile: "text/plain; charset=utf-8",
  mmd: "text/plain; charset=utf-8",
  mermaid: "text/plain; charset=utf-8",
  // Image allowlist.
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  svg: "image/svg+xml",
  webp: "image/webp",
});

/**
 * Sanitize a filename for use inside `Content-Disposition: inline;
 * filename="<sanitized>"`.
 *
 * Contract:
 *   - ASCII alphanumerics + `. _ -` + spaces are preserved.
 *   - All other characters (including CR, LF, ", \, ;, non-ASCII) are
 *     replaced with `_`. This blocks header-injection via CR/LF, avoids
 *     the need for RFC 6266 percent-encoding, and produces a filename
 *     the client can safely render back.
 *   - Result is clamped to 120 characters. If the original was longer
 *     we preserve the extension when possible.
 *   - Empty result falls back to "file".
 *
 * This is intentionally MORE restrictive than RFC 6266 allows — the UI
 * only needs the filename as a hint; we prefer a conservative char class
 * over round-trip fidelity.
 */
export function sanitizeContentDispositionFilename(raw: string): string {
  const base = basename(raw || "").normalize("NFKC");
  if (base.length === 0) return "file";

  // Replace anything outside the allowed class with `_`.
  const cleaned = base.replace(/[^A-Za-z0-9._ -]/g, "_");

  if (cleaned.length === 0) return "file";
  if (cleaned.length <= 120) return cleaned;

  // Clamp to 120, preserving the extension if we can.
  const dot = cleaned.lastIndexOf(".");
  if (dot > 0 && cleaned.length - dot <= 16) {
    const ext = cleaned.slice(dot);
    const headLen = 120 - ext.length;
    return cleaned.slice(0, headLen) + ext;
  }
  return cleaned.slice(0, 120);
}
