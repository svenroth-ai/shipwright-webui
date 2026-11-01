/*
 * terminalLinkMatch — pure text -> file-path link candidates for the embedded
 * terminal (FR-01.28). A candidate is a whitespace-delimited token that, once
 * wrapping punctuation is stripped, `parseFileRef` (the SAME recogniser the
 * Mission chat chips use) accepts as a file path. A space always ends a path:
 * names containing spaces are deliberately not linked (they cannot be told
 * apart from prose in a terminal grid).
 *
 * http(s) links are NOT handled here — the web-links addon owns them; tokens
 * containing "://" are skipped so the two never overlap. No I/O, no xterm.
 */
import { parseFileRef, type FileRef } from "../../lib/viewerTarget";

export interface FileLinkCandidate {
  /** Start offset in `text` (inclusive). */
  start: number;
  /** End offset in `text` (exclusive). */
  end: number;
  ref: FileRef;
}

// Characters that wrap a path in prose / TUI chrome: quotes, brackets, `@` mentions, box borders.
const LEAD = new Set(["(", "[", "{", "<", '"', "'", "`", "@", "|", "│", "┃", "║"]);
const TRAIL = new Set([".", ",", ";", ":", "!", "?", ")", "]", "}", ">", '"', "'", "`", "|", "│", "┃", "║"]);
// tsc style `a.ts(12,5)` / `a.ts(12)`.
const TSC_SUFFIX = /^(.+?)\((\d+)(?:,\d+)?\)$/;
// `--flag=value` / `KEY=value`: the value is the candidate.
const ASSIGN = /^[-\w.]+=(?=.)/;

// An absolute-path head ("C:\", "C:/", "/", "\", "./", "~/"). When such a token is no file by itself, the
// tokens after it may be the tail of a path containing a space.
const PATHISH = /^(?:[A-Za-z]:[\\/]|[\\/]|\.{1,2}[\\/]|~[\\/])/;
// parseFileRef refuses anything longer than 1024; do not tokenise megabyte-long runs at all.
const MAX_TOKEN = 1024;
// A spaced path is assumed to have at most this many separator-less words between head and file name.
const MAX_CHAIN_WORDS = 4;

export function findFileLinkCandidates(text: string): FileLinkCandidate[] {
  const out: FileLinkCandidate[] = [];
  const tokens = /\S+/g;
  // Inside a path that contains spaces ("C:\Program Files\My App\a.ts"): it starts at a path head that is
  // no file, continues over words and separator-carrying tokens, and ends at the first token that is a
  // file. Tokens inside it must NOT be linked alone (they would resolve against the wrong folder).
  let inChain = false;
  let chainWords = 0;
  for (let m = tokens.exec(text); m; m = tokens.exec(text)) {
    if (m[0].length > MAX_TOKEN) {
      inChain = false;
      continue;
    }
    let start = m.index;
    let end = m.index + m[0].length;
    const eq = ASSIGN.exec(m[0]);
    if (eq) start += eq[0].length;
    while (start < end && LEAD.has(text[start]!)) start++;
    // Trailing punctuation off, repeatedly; a tsc `(12,5)` suffix is recognised before `)` is stripped.
    let tsc: RegExpExecArray | null = null;
    const hasParen = text.slice(start, end).includes("("); // a tsc suffix needs one; skips the regex on `)))...` runs
    while (end > start) {
      tsc = hasParen && text[end - 1] === ")" ? TSC_SUFFIX.exec(text.slice(start, end)) : null;
      if (tsc || !TRAIL.has(text[end - 1]!)) break;
      end--;
    }
    if (end <= start) continue;
    const shown = text.slice(start, end);
    const ref = shown.includes("://") || shown.startsWith("~") ? null : tsc ? parseFileRef(tsc[1]!) : parseFileRef(shown);
    const suppressed = inChain;
    if (PATHISH.test(shown) && !shown.includes("://")) {
      inChain = ref === null;
      chainWords = 0;
    } else if (inChain) {
      if (ref !== null) inChain = false;
      else if (!/[\\/]/.test(shown) && ++chainWords > MAX_CHAIN_WORDS) inChain = false;
    }
    if (suppressed || !ref) continue;
    out.push({ start, end, ref: tsc ? { path: ref.path, line: Number(tsc[2]) } : ref });
  }
  return out;
}
