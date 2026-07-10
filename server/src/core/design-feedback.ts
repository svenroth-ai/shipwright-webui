/*
 * core/design-feedback.ts — pure helpers for the single-session design-gate
 * feedback round file (iterate-2026-07-10-design-gate-review-host, FR-01.45).
 *
 * The design phase's emitted review viewer (`.shipwright/designs/index.html`)
 * already generates a contract-shaped feedback markdown; the WebUI HOSTS that
 * viewer and, on Export, writes it straight into the worktree. Two invariants
 * the viewer alone cannot satisfy live here, both pure + unit-tested:
 *
 *   1. `computeNextRound` — the round number N is derived from the round FILES
 *      that already exist on disk, NOT the viewer's localStorage counter
 *      (which resets across sessions/machines). AC3.
 *   2. `normalizeRoundHeading` — rewrite ONLY the heading's round integer to N,
 *      preserving every other byte (incl. the em-dash) so the monorepo Option-B
 *      reader still parses the file. AC4.
 *
 * These are the sole transforms the server applies; the per-screen / per-split
 * body is passed through verbatim.
 */

/** `design-feedback-round<N>.md` (case-insensitive), capturing N. */
const ROUND_FILE_RE = /^design-feedback-round(\d+)\.md$/i;

/**
 * The first-line feedback heading the viewer emits:
 * `# Design Feedback — Round <N>`. The dash class accepts em-dash (— —,
 * what the viewer emits), en-dash (– –) and hyphen-minus (-) so a
 * hand-edited or variant file still normalizes. `/m` anchors to a line; NO `/g`
 * → only the FIRST heading is touched (never a "Round N" inside free-text notes
 * or a history block).
 */
const ROUND_HEADING_RE =
  /^(#\s+Design Feedback\s*[—–-]\s*Round\s+)(\d+)(.*)$/m;

/**
 * True when line 1 IS the round heading the viewer emits (contract guard). This
 * is deliberately the SAME shape {@link normalizeRoundHeading} rewrites and is
 * anchored to the first line, so a body that passes here is guaranteed to
 * normalize AND the (non-global) heading rewrite lands on line 1 — never on a
 * "Round N" buried in a note/history block (review #2).
 */
export function looksLikeDesignFeedback(markdown: string): boolean {
  const firstLine = markdown.split(/\r?\n/, 1)[0] ?? "";
  return /^#\s+Design Feedback\s*[—–-]\s*Round\s+\d+/.test(firstLine);
}

/** Round number encoded in a file name, or null when it is not a round file. */
export function roundOfFileName(name: string): number | null {
  const m = ROUND_FILE_RE.exec(name);
  if (!m) return null;
  const n = Number.parseInt(m[1], 10);
  return Number.isSafeInteger(n) && n >= 1 ? n : null;
}

/**
 * Next round number = max(existing round on disk) + 1 (AC3). Non-round files
 * are ignored; comparison is numeric (round10 > round2); an empty / round-less
 * directory yields 1.
 */
export function computeNextRound(fileNames: readonly string[]): number {
  let max = 0;
  for (const name of fileNames) {
    const n = roundOfFileName(name);
    if (n !== null && n > max) max = n;
  }
  return max + 1;
}

/**
 * The canonical round file name for round `n`. `n` is a server-computed
 * integer, so the name is injection-free by construction.
 */
export function roundFileName(n: number): string {
  return `design-feedback-round${n}.md`;
}

/**
 * Rewrite the heading's round integer to `round`, preserving the dash style and
 * every other byte. If no heading is present the input is returned unchanged
 * (the write route rejects a non-contract body upstream via
 * {@link looksLikeDesignFeedback}).
 */
export function normalizeRoundHeading(markdown: string, round: number): string {
  return markdown.replace(
    ROUND_HEADING_RE,
    (_full, prefix: string, _n: string, suffix: string) =>
      `${prefix}${round}${suffix}`,
  );
}
