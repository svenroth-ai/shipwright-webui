/*
 * jsonl-decode.ts — JSON decoding primitives for the record splitter.
 *
 * Extracted from `jsonl-records.ts` (iterate-2026-07-21-compliance-audit-reconcile,
 * Group H1) purely to keep both files inside the 300-line rule. The seam is the
 * natural one, not an arbitrary cut: everything here answers "where does ONE
 * JSON object end?", while `jsonl-records.ts` answers "what records are on this
 * LINE, and is the file safely appendable?".
 *
 * These symbols are INTERNAL to that pair — `jsonl-records.ts` is the only
 * importer, and it remains the public face (`splitRecords`, `parseJsonlRecords`,
 * `recordsFromLines`, `endsWithoutNewline`, `CorruptFragment`). Consumers import
 * from there; nothing outside imports this module.
 *
 * The cross-language contract, the port deviations from
 * `shared/scripts/lib/jsonl_records.py`, and the reason this leaf exists at all
 * are documented in `jsonl-records.ts` — read that header first.
 */

// Explicitly JSON's whitespace set as CHAR CODES, NOT a unicode-aware test:
// `String.prototype.trim` and Python's `str.isspace` are both unicode-aware and
// would silently accept NBSP / U+000B / U+000C BETWEEN records, diverging from
// every other JSON consumer of the same bytes.
const CH_SPACE = 32;
const CH_TAB = 9;
const CH_CR = 13;
export const CH_LF = 10;
export const CH_LBRACE = 0x7b; // {
const CH_RBRACE = 0x7d; // }

// Slow-path ceilings (external review, medium/performance). Both degrade to
// "fragment" — a safe, already-tested outcome, never a throw. A real triage
// record is ~370 bytes with at most trivial nesting, so these sit orders of
// magnitude above legitimate input: they bound an adversarial or badly-
// truncated line, they do not shape normal behaviour.
const MAX_DECODE_ATTEMPTS = 1024;
export const MAX_RECOVERY_LINE_BYTES = 1_000_000;

function isJsonWs(code: number): boolean {
  return code === CH_SPACE || code === CH_TAB || code === CH_CR || code === CH_LF;
}

export function skipJsonWs(line: string, from: number): number {
  let idx = from;
  while (idx < line.length && isJsonWs(line.charCodeAt(idx))) idx += 1;
  return idx;
}

/**
 * `JSON.parse` restricted to plain objects. Returns undefined for invalid JSON
 * AND for valid-but-wrong-shape input (a bare scalar or a top-level array):
 * callers do `raw.event`, so a non-object is a fragment, not a record.
 */
export function tryParseObject(candidate: string): Record<string, unknown> | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    return undefined;
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return undefined;
  }
  return parsed as Record<string, unknown>;
}

/**
 * Decode one JSON object beginning at `start`, by walking candidate end
 * positions at each `}` and letting native `JSON.parse` validate each slice.
 *
 * This is SELF-CORRECTING for braces inside string values: a candidate ending
 * at an in-string `}` is unbalanced and simply fails to parse, so the walk
 * continues. The SHORTEST valid prefix is the correct record boundary, because
 * any shorter prefix ending at `}` is necessarily unbalanced.
 *
 * Deliberately NOT a hand-rolled JSON lexer (external review R2): brace
 * counting with escaped quotes and backslash runs is a classic source of latent
 * bugs, and delegating validation to V8 removes that whole class.
 */
export function decodeObjectAt(
  line: string,
  start: number,
): { value: Record<string, unknown>; end: number } | null {
  let attempts = 0;
  for (let i = start; i < line.length; i += 1) {
    if (line.charCodeAt(i) !== CH_RBRACE) continue;
    // Work budget. Each attempt slices AND parses, so an adversarial line is
    // O(candidates x length) on the request thread — and the board read path
    // (triage-compose → readLocalRawLinesSplit) bypasses `readAllItems`' 5 s
    // cache, so a corrupt line re-pays the cost on EVERY poll with nothing ever
    // repairing the file. Python pays one `raw_decode`; the brace walk is the
    // price of not hand-rolling a lexer, so it gets a ceiling.
    attempts += 1;
    if (attempts > MAX_DECODE_ATTEMPTS) return null;
    const value = tryParseObject(line.slice(start, i + 1));
    if (value !== undefined) return { value, end: i + 1 };
  }
  return null;
}
