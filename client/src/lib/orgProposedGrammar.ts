/*
 * orgProposedGrammar.ts (client mirror) — the line grammar of `decisions-proposed.md`
 * / `decision_log.md` entries written by the leadwright daemon (W1). Contract:
 * `docs/org-proposed-entry-contract.md`.
 *
 * Everything below the GRAMMAR marker is mirrored VERBATIM in
 * `server/src/external/org/proposed-grammar.ts` (CLAUDE.md rule 7: no cross-package
 * import); `orgDecisionsApi.daemon-header.test.ts` fails when the two bodies
 * differ, and the shared adversarial corpus is the behavioural parity gate.
 *
 * Integrity beats availability on the reading side: whenever a fence is
 * ambiguous (a fence line, marker or header-looking line inside the quote, or
 * an opener with no valid close) the owner entry is NOT listed and nothing
 * inside the region is listed either - an unlisted proposal is acceptable, a
 * forged one is not.
 */

// ---- GRAMMAR (verbatim mirror below this line) ----

export const WEBUI_HEADER_RE = /^## \[([^\]]+)\] (.+?)\r?$/;
export const DAEMON_HEADER_RE = /^## Proposed (\S+) — (.+?)\r?$/;
export const DAEMON_MARKER_RE = /^<!--[ \t]*decisionKey:.*-->\r?$/; // linear: no adjacent overlapping quantifiers
export const FENCE_LINE_RE = /^⟦SHIPWRIGHT-FENCE:[0-9a-f]+⟧\r?$/;
export const LEAD_ID_RE = /^[a-z0-9][a-z0-9-]*$/; // same rule as the countersign route
export const LEAD_BULLET_RE = /^-[ \t]*\*\*Lead:\*\*([^\r\n]*)\r?$/;
export const EVIDENCE_BULLET_RE = /^-[ \t]*\*\*Evidence:\*\*([^\r\n]*)\r?$/;
export const FENCE_LABEL_PREFIX = "[FENCED DATA";
const LOGGED_HEADER_LINE_RE = /^## ADR-\d{4,} \[/;
const PROPOSAL_MARKER_RE = /^<!--[ \t]*proposal:/; // only countersign writes it (the log's block fingerprint)
export const ISO_TIMESTAMP_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/; // same rule as the countersign route

export const stripBom = (s: string): string => (s.charCodeAt(0) === 0xfeff ? s.slice(1) : s);
export const isBlank = (line: string): boolean => line.trim() === "";

/** First line after `open` equal to it, ignoring a trailing CR; -1 if none. */
export function findClose(lines: string[], open: number): number {
  const want = lines[open].trimEnd();
  for (let k = open + 1; k < lines.length; k++) if (lines[k].trimEnd() === want) return k;
  return -1;
}

/** After a closing fence line the daemon writes: blank, Lead bullet, Evidence
 *  bullet. Returns the index just past the Evidence bullet, or -1. */
export function canonicalTailEnd(lines: string[], close: number): number {
  let j = close + 1;
  if (j >= lines.length || !isBlank(lines[j])) return -1;
  while (j < lines.length && isBlank(lines[j])) j++;
  if (!LEAD_BULLET_RE.test(lines[j] ?? "") || !EVIDENCE_BULLET_RE.test(lines[j + 1] ?? "")) return -1;
  return j + 2;
}

export function markerAbove(lines: string[], idx: number): boolean {
  let m = idx - 1;
  while (m >= 0 && isBlank(lines[m])) m--;
  return m >= 0 && DAEMON_MARKER_RE.test(lines[m]);
}

/** Anything that only a real entry (or an injected fake one) contains. */
function isStructural(line: string): boolean {
  return (
    FENCE_LINE_RE.test(line) || DAEMON_MARKER_RE.test(line) || WEBUI_HEADER_RE.test(line) ||
    DAEMON_HEADER_RE.test(line) || LOGGED_HEADER_LINE_RE.test(line) || PROPOSAL_MARKER_RE.test(line)
  );
}

export function structuralInside(lines: string[], from: number, to: number): boolean {
  for (let k = from; k < to; k++) if (isStructural(lines[k])) return true;
  return false;
}

/** Which file is being read: a proposed file only knows `## Proposed` owners
 *  (with their marker above), decision_log.md only `## ADR-` owners. */
export type FenceFileKind = "proposed" | "logged";

const OWNER_RE: Record<FenceFileKind, RegExp> = {
  proposed: /^## (Proposed \S+ — |\[[^\]]+\] )/, // daemon form, or a WebUI-form header that has a marker above
  logged: /^## ADR-\d{4,} \[/,
};

/** logged: a masked region must never swallow another entry's owner header. */
function crossesLoggedOwner(lines: string[], from: number, to: number): boolean {
  for (let k = from; k < to; k++) {
    if (LOGGED_HEADER_LINE_RE.test(lines[k]) && DAEMON_MARKER_RE.test(lines[k + 1] ?? "")) return true;
  }
  return false;
}

export interface FenceScan {
  /** Lines inside a fenced region (open line, label, text, close line). */
  fenced: Set<number>;
  /** Owner header lines whose region is ambiguous: never listed (proposed). */
  ambiguousOwners: Set<number>;
  /** Proposed file: lines at or after this index cannot be trusted (a dangling
   *  opener has no valid close). `lines.length` when nothing is poisoned. */
  poisonFrom: number;
}

/**
 * A fence opens ONLY where the daemon puts it: the first line after an owner
 * header (marker/blank skipped) that is a fence line followed by the label; it
 * closes at the next identical line, which must be followed by the canonical
 * Lead/Evidence tail. proposed: a region holding any structural line is
 * ambiguous (owner unlisted, region masked); an opener without a valid close
 * poisons everything after it. logged: single writer (the countersign), so a
 * valid region is ALWAYS masked - quoted `## ADR-` lines never become entries.
 */
export function scanFences(lines: string[], kind: FenceFileKind): FenceScan {
  const fenced = new Set<number>();
  const ambiguousOwners = new Set<number>();
  let poisonFrom = lines.length;
  let i = 0;
  while (i < lines.length) {
    // proposed: owner = header with its decisionKey marker above; logged: owner = ADR header
    // directly followed by a marker (the only shape countersign writes for a daemon entry)
    // (owner shape first: the marker lookup only runs for owner-shaped lines)
    if (OWNER_RE[kind].test(lines[i]) && (kind === "proposed" ? markerAbove(lines, i) : DAEMON_MARKER_RE.test(lines[i + 1] ?? ""))) {
      let j = i + 1;
      while (j < lines.length && (isBlank(lines[j]) || DAEMON_MARKER_RE.test(lines[j]))) j++;
      if (j + 1 < lines.length && FENCE_LINE_RE.test(lines[j]) && lines[j + 1].startsWith(FENCE_LABEL_PREFIX)) {
        const close = findClose(lines, j);
        if (close !== -1 && canonicalTailEnd(lines, close) !== -1 && !(kind === "logged" && crossesLoggedOwner(lines, j, close))) {
          for (let k = j; k <= close; k++) fenced.add(k);
          if (kind === "proposed" && structuralInside(lines, j + 2, close)) ambiguousOwners.add(i);
          i = close + 1;
          continue;
        }
        if (kind === "proposed") {
          ambiguousOwners.add(i);
          poisonFrom = j;
          break;
        }
      }
    }
    i++;
  }
  return { fenced, ambiguousOwners, poisonFrom };
}

/** Lines of a daemon entry that come after its closing fence line (or the
 *  whole block when it has no fence). */
export function daemonTail(blockLines: string[]): string[] {
  let j = 0;
  while (j < blockLines.length && (isBlank(blockLines[j]) || DAEMON_MARKER_RE.test(blockLines[j]) || blockLines[j].startsWith("## "))) j++;
  // No fence where the daemon puts it: no quote to skip, the rest is the tail.
  if (!(FENCE_LINE_RE.test(blockLines[j] ?? "") && (blockLines[j + 1] ?? "").startsWith(FENCE_LABEL_PREFIX))) return blockLines.slice(j);
  const close = findClose(blockLines, j);
  return close === -1 ? [] : blockLines.slice(close + 1); // unclosed fence = corrupt: no identity
}

/** A daemon entry is exactly what `renderEntry` writes: marker, header, blank,
 *  fence + label + plain text + fence, blank, Lead, Evidence, nothing else. Any
 *  extra line, or any structural line inside the quote, makes it non-canonical:
 *  not listed, so never countersigned into the log. */
export function isCanonicalDaemonBlock(blockLines: string[]): boolean {
  let j = 0;
  let sawMarker = false;
  while (j < blockLines.length && (isBlank(blockLines[j]) || DAEMON_MARKER_RE.test(blockLines[j]))) {
    if (!isBlank(blockLines[j])) sawMarker = true;
    j++;
  }
  if (!sawMarker) return false; // listing and masking use one rule: a daemon entry has its marker
  const header = blockLines[j] ?? "";
  if (!DAEMON_HEADER_RE.test(header) && !WEBUI_HEADER_RE.test(header)) return false;
  j++;
  while (j < blockLines.length && isBlank(blockLines[j])) j++;
  if (!FENCE_LINE_RE.test(blockLines[j] ?? "") || !(blockLines[j + 1] ?? "").startsWith(FENCE_LABEL_PREFIX)) return false;
  const close = findClose(blockLines, j);
  if (close === -1 || structuralInside(blockLines, j + 2, close)) return false;
  const end = canonicalTailEnd(blockLines, close);
  return end !== -1 && blockLines.slice(end).every(isBlank);
}

/** First bullet of `lines` matching `re` (capture 1, trimmed), or null. */
export function firstBullet(lines: string[], re: RegExp): string | null {
  for (const l of lines) {
    const m = re.exec(l);
    if (m) return m[1].trim();
  }
  return null;
}

// ---- W4: proposed line / quote classification and evidence pointer ----

export type SourceRef =
  | { kind: "known"; session: string; time: string; message: string }
  | { kind: "unknown"; raw: string | null };

const POINTER_ISO = String.raw`\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z`;
const SHORT_POINTER_RE = new RegExp(String.raw`^([A-Za-z0-9_-]{1,64}):(${POINTER_ISO}):(\d{1,9})$`);
const LONG_POINTER_RE = new RegExp(String.raw`^session ([A-Za-z0-9_-]{1,64}) at (${POINTER_ISO}), message (\d{1,9})$`);

/** `session:time:number` or `session <id> at <time>, message <n>`; anything else is unknown. */
export function parseSourceRef(raw: string | null): SourceRef {
  const t = raw?.trim() ?? "";
  if (t === "") return { kind: "unknown", raw: null };
  const m = SHORT_POINTER_RE.exec(t) ?? LONG_POINTER_RE.exec(t);
  if (!m) return { kind: "unknown", raw: t };
  return { kind: "known", session: m[1], time: m[2], message: m[3] };
}

export interface FencedParts {
  /** The fence label line (carries the beat). */
  label: string;
  /** Fenced lines that are not quotes: the proposed line. */
  proposed: string[];
  /** Fenced lines starting with `>`, verbatim. */
  quotes: string[];
}

/** The ONE rule that splits a fenced region into proposed line and quotes: a
 *  line starting with `>` is a quote, every other line is the proposed line.
 *  `null` when the block has no fence where the daemon puts it. The block must already be canonical: a fence
 *  opened by the daemon's own label line, lines split on LF (a trailing CR is dropped). */
export function fencedParts(blockLines: string[]): FencedParts | null {
  const lines = blockLines.map((l) => l.replace(/\r$/, ""));
  const open = lines.findIndex((l, i) => FENCE_LINE_RE.test(l) && (lines[i + 1] ?? "").startsWith(FENCE_LABEL_PREFIX));
  const close = open === -1 ? -1 : findClose(lines, open);
  if (open === -1 || close === -1) return null;
  const inside = lines.slice(open + 2, close);
  return { label: lines[open + 1], proposed: inside.filter((l) => !l.trimStart().startsWith(">")), quotes: inside.filter((l) => l.trimStart().startsWith(">")) };
}

export const QUOTE_PREFIX_RE = /^\s*>[ \t]?/;
const QUOTE_SEP = " — ";
const POINTER_ATTEMPT_RE = /^(?:session\b|[A-Za-z0-9_-]{4,}:\S|[A-Za-z0-9_-]+:\d{4}-\d{2})/;

/** ONE quote line -> its text and, when the suffix after the LAST ` — ` looks like a pointer attempt, that pointer.
 *  An em dash inside the quote text stays in it. */
export function splitQuote(line: string): { text: string; pointer: string | null } {
  const body = line.replace(QUOTE_PREFIX_RE, "");
  const at = body.lastIndexOf(QUOTE_SEP);
  const suffix = at === -1 ? "" : body.slice(at + QUOTE_SEP.length).trim();
  if (at === -1 || !POINTER_ATTEMPT_RE.test(suffix)) return { text: body.trim(), pointer: null };
  return { text: body.slice(0, at).trim(), pointer: suffix };
}

/** Comparison form of a text: Unicode-folded (NFKC, so NBSP and wide forms), every invisible character removed
 *  (including emoji presentation selectors), one line, lower case. Never written anywhere. It strips exactly what
 *  `normalizeLine` strips on the write path, and more (it also drops the emoji selector), so a line can never hide a
 *  quote by an invisible difference. */
export function foldForCompare(text: string): string {
  return normalizeLine(stripInvisible(stripInvisible(text, false).normalize("NFKC"), false)).toLowerCase();
}

// Code points that render as nothing: format characters (tag characters, bidi overrides, zero width, ...), default
// ignorables (variation selectors, fillers), private use, lone surrogates, C1 controls and the braille blank.
const INVISIBLE = String.raw`\p{Cf}\p{Default_Ignorable_Code_Point}\p{Co}\p{Cs}\u0080-\u009f\u2800\uFDD0-\uFDEF\uFFFE\uFFFF`;
const INVISIBLE_ALL_RE = new RegExp(`[${INVISIBLE}]`, "gu");
// An emoji presentation selector (U+FE0F) that directly follows an emoji base (or a keycap base before U+20E3) is
// kept: dropping it turns a red heart into a text glyph. Every other selector is removed.
const INVISIBLE_KEEP_EMOJI_RE = new RegExp(String.raw`(\p{Extended_Pictographic}\uFE0F)|([0-9#*]\uFE0F(?=\u20E3))|[${INVISIBLE}]`, "gu");

/** Invisible characters removed from anything shown as, or written as, the line (see INVISIBLE). The log is read by
 *  agents as authority. `keepEmojiPresentation` (default) keeps U+FE0F after an emoji base; ZWJ stays stripped. */
export function stripInvisible(text: string, keepEmojiPresentation = true): string {
  return keepEmojiPresentation ? text.replace(INVISIBLE_KEEP_EMOJI_RE, (_m, emoji?: string, keycap?: string) => emoji ?? keycap ?? "") : text.replace(INVISIBLE_ALL_RE, "");
}

/** One line for the log: invisible characters removed, Unicode space separators (NBSP, ideographic space, ...)
 *  become a plain space, control characters (newlines too) and runs of blanks become one space. */
export function normalizeLine(text: string): string {
  return stripInvisible(text).replace(/\p{Zs}/gu, " ").replace(/[\u0000-\u001f\u007f\u2028\u2029]+/g, " ").replace(/ {2,}/g, " ").trim();
}

/** The text both sides hash to tell "the entry I saw" from "the entry now": no BOM, no CR, no trailing blanks. */
export const blockForDigest = (block: string): string => stripBom(block).replace(/\r/g, "").trimEnd();
