/*
 * external/org/proposed-entry-format.ts — the `decisions-proposed.md` entry
 * grammar, tolerant of BOTH header forms (campaign shadow-proposals-webui, W1).
 *
 *   WebUI form  : `## [<timestamp>] <leadId>`
 *   Daemon form : `<!-- decisionKey: <encoded-key> -->` (marker line, directly
 *                 above, blank lines tolerated) + `## Proposed <timestamp> —
 *                 <decisionKey>`; the lead id is NOT in the header, it is the
 *                 `- **Lead:** <id>` bullet the daemon renders right AFTER
 *                 the closing fence line (leadwright `lib/decisions-proposed.ts`
 *                 `renderEntry`).
 *
 * Identity is `(timestamp, leadId)` for both forms. Cross-repo contract and
 * pinned sample: `docs/org-proposed-entry-contract.md` +
 * `__tests__/fixtures/decisions-proposed-daemon-sample.md`.
 *
 * The daemon's marker line belongs to the entry BELOW it, so a daemon
 * entry's block starts at the marker — removing an entry takes its marker
 * with it, never leaves it on the previous entry's tail.
 *
 * Injection defence (the quoted text and the evidence pointer are
 * lead-written free text): (1) header lines between a daemon entry's two
 * identical fence-marker lines are NOT headers — a quote cannot split an
 * entry or forge an identity; (2) the lead is the FIRST bullet after the
 * closing fence line, so a `- **Lead:**` smuggled into the quote (before) or
 * into the evidence pointer (after the real bullet) never wins.
 */

const WEBUI_HEADER_RE = /^## \[([^\]]+)\] (.+?)\r?$/;
const DAEMON_HEADER_RE = /^## Proposed (\S+) — (.+?)\r?$/;
const DAEMON_MARKER_RE = /^<!--\s*decisionKey:\s*.*?\s*-->\r?$/;
const FENCE_LINE_RE = /^⟦SHIPWRIGHT-FENCE:[0-9a-f]+⟧\r?$/;
const LEAD_ID_RE = /^[a-z0-9][a-z0-9-]*$/; // same rule as the countersign route
const LEAD_BULLET_RE = /^-[ \t]*\*\*Lead:\*\*[ \t]*(.+?)\r?$/;
const EVIDENCE_BULLET_RE = /^-[ \t]*\*\*Evidence:\*\*[ \t]*(.+?)\r?$/;

export interface ProposedEntry {
  timestamp: string;
  leadId: string;
  /** Full block text (optional marker + header line + body), from this entry's
   *  first line up to the next entry's first line or EOF. Opaque. */
  block: string;
  startIndex: number;
  endIndex: number;
}

const isBlank = (line: string): boolean => line.trim() === "";

const FENCE_LABEL_PREFIX = "[FENCED DATA";
/** After a closing fence line the daemon writes: blank, Lead bullet, Evidence
 *  bullet. Returns the index just past the Evidence bullet, or -1. */
function canonicalTailEnd(lines: string[], close: number): number {
  let j = close + 1;
  if (j >= lines.length || !isBlank(lines[j])) return -1;
  while (j < lines.length && isBlank(lines[j])) j++;
  if (!LEAD_BULLET_RE.test(lines[j] ?? "") || !EVIDENCE_BULLET_RE.test(lines[j + 1] ?? "")) return -1;
  return j + 2;
}

function markerAbove(lines: string[], idx: number): boolean {
  let m = idx - 1;
  while (m >= 0 && isBlank(lines[m])) m--;
  return m >= 0 && DAEMON_MARKER_RE.test(lines[m]);
}

/** A daemon entry is exactly what `renderEntry` writes: [marker] header, blank,
 *  fence + label + text + fence, blank, Lead, Evidence, nothing else. Any extra
 *  line (an evidence pointer / decisionKey carrying a newline) makes it
 *  non-canonical: not listed, so never countersigned into the log. */
function isCanonicalDaemonBlock(blockLines: string[]): boolean {
  let j = 0;
  let sawMarker = false;
  while (j < blockLines.length && (isBlank(blockLines[j]) || DAEMON_MARKER_RE.test(blockLines[j]))) {
    if (!isBlank(blockLines[j])) sawMarker = true;
    j++;
  }
  if (!sawMarker) return false; // listing and masking use one rule: a daemon entry has its marker
  if (!DAEMON_HEADER_RE.test(blockLines[j] ?? "")) return false;
  j++;
  while (j < blockLines.length && isBlank(blockLines[j])) j++;
  if (!FENCE_LINE_RE.test(blockLines[j] ?? "") || !(blockLines[j + 1] ?? "").startsWith(FENCE_LABEL_PREFIX)) return false;
  const close = blockLines.indexOf(blockLines[j], j + 1);
  if (close === -1) return false;
  const end = canonicalTailEnd(blockLines, close);
  return end !== -1 && blockLines.slice(end).every(isBlank);
}

/** Which file is being read. A proposed file only knows daemon entries (a
 *  `## Proposed` header with its marker above); decision_log.md only knows
 *  `## ADR-` headers. A header of the other kind opens nothing. */
export type FenceFileKind = "proposed" | "logged";

const OWNER_RE: Record<FenceFileKind, RegExp> = {
  proposed: /^## Proposed \S+ — /,
  logged: /^## ADR-\d{4} \[/,
};

/** A fence-open pair (fence line + label) or a marker directly above a daemon
 *  header: what only a real entry (or an injected fake one) contains. */
function hasNestedOpener(lines: string[], from: number, to: number): boolean {
  for (let k = from; k < to; k++) {
    if (FENCE_LINE_RE.test(lines[k]) && (lines[k + 1] ?? "").startsWith(FENCE_LABEL_PREFIX)) return true;
    if (DAEMON_MARKER_RE.test(lines[k])) {
      let n = k + 1;
      while (n < to && isBlank(lines[n])) n++;
      if (DAEMON_HEADER_RE.test(lines[n] ?? "")) return true;
    }
  }
  return false;
}

/** Line indexes that lie inside a fenced region (open line, label, text and
 *  close line). A fence opens ONLY where the daemon puts it: the first line
 *  after an owner header (marker/blank lines skipped) that is a fence line
 *  followed by the label; it closes at the next identical line, which must be
 *  followed by the canonical Lead/Evidence tail. A fence-looking line anywhere
 *  else opens nothing. Fail-safe: a region that itself contains a fence-open
 *  pair or a marker + daemon header is an injection (or swallows real
 *  entries) - it is NOT masked, so nested real entries parse normally and the
 *  fake one is dropped later as non-canonical. */
export function fencedLineSet(lines: string[], kind: FenceFileKind): Set<number> {
  const fenced = new Set<number>();
  let i = 0;
  while (i < lines.length) {
    if (OWNER_RE[kind].test(lines[i]) && (kind === "logged" || markerAbove(lines, i))) {
      let j = i + 1;
      while (j < lines.length && (isBlank(lines[j]) || DAEMON_MARKER_RE.test(lines[j]))) j++;
      if (j + 1 < lines.length && FENCE_LINE_RE.test(lines[j]) && lines[j + 1].startsWith(FENCE_LABEL_PREFIX)) {
        const close = lines.indexOf(lines[j], j + 1);
        if (close !== -1 && canonicalTailEnd(lines, close) !== -1 && !hasNestedOpener(lines, j + 2, close)) {
          for (let k = j; k <= close; k++) fenced.add(k);
          i = close + 1;
          continue;
        }
      }
    }
    i++;
  }
  return fenced;
}

/** Lines of a daemon entry that come after its closing fence line (or the
 *  whole block when it has no fence). */
function daemonTail(blockLines: string[]): string[] {
  let j = 0;
  while (j < blockLines.length && (isBlank(blockLines[j]) || DAEMON_MARKER_RE.test(blockLines[j]) || blockLines[j].startsWith("## "))) j++;
  // No fence where the daemon puts it: no quote to skip, the rest is the tail.
  if (!(FENCE_LINE_RE.test(blockLines[j] ?? "") && (blockLines[j + 1] ?? "").startsWith(FENCE_LABEL_PREFIX))) return blockLines.slice(j);
  const close = blockLines.indexOf(blockLines[j], j + 1);
  return close === -1 ? [] : blockLines.slice(close + 1); // unclosed fence = corrupt: no identity
}

/** First `- **Lead:** <id>` bullet in `lines`, or null. */
function leadFromTail(lines: string[]): string | null {
  for (const l of lines) {
    const m = LEAD_BULLET_RE.exec(l);
    if (m) return m[1].trim();
  }
  return null;
}

/** Parse `decisions-proposed.md` into its header-delimited entries. */
export function parseProposedEntries(raw: string): ProposedEntry[] {
  const lines = raw.split("\n");
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  const fenced = fencedLineSet(lines, "proposed");

  interface Head { startLine: number; timestamp: string; leadFromHeader: string | null }
  const heads: Head[] = [];
  lines.forEach((line, idx) => {
    if (fenced.has(idx)) return;
    const w = WEBUI_HEADER_RE.exec(line);
    // A WebUI-form header glued right under a daemon header is a decisionKey
    // that carried a newline, not an entry.
    if (w && idx > 0 && DAEMON_HEADER_RE.test(lines[idx - 1])) return;
    if (w) {
      heads.push({ startLine: idx, timestamp: w[1], leadFromHeader: w[2] });
      return;
    }
    const d = DAEMON_HEADER_RE.exec(line);
    if (d) {
      let m = idx - 1;
      while (m >= 0 && isBlank(lines[m])) m--;
      const hasMarker = m >= 0 && !fenced.has(m) && DAEMON_MARKER_RE.test(lines[m]);
      heads.push({ startLine: hasMarker ? m : idx, timestamp: d[1], leadFromHeader: null });
    }
  });

  const out: ProposedEntry[] = [];
  heads.forEach((h, i) => {
    const startIndex = lineStarts[h.startLine];
    const next = heads[i + 1];
    const endIndex = next ? lineStarts[next.startLine] : raw.length;
    const block = raw.slice(startIndex, endIndex);
    if (h.leadFromHeader === null && !isCanonicalDaemonBlock(block.split("\n"))) return;
    const leadId = h.leadFromHeader ?? leadFromTail(daemonTail(block.split("\n")));
    // A daemon entry with no Lead bullet has no identity the countersign
    // route could address: it is not listed. Its text is still part of the
    // byte range ending where the next HEADER starts, but no listed entry
    // owns it, so countersigning another entry never moves or removes it.
    if (leadId === null || (h.leadFromHeader === null && !LEAD_ID_RE.test(leadId))) return; // listed == countersignable
    out.push({ timestamp: h.timestamp, leadId, block, startIndex, endIndex });
  });
  return out;
}

/** Header of a single proposed block (first line, or marker + header). */
function headerOf(block: string): { timestamp: string; leadId: string | null; marker: string | null; rest: string } | null {
  const lines = block.split("\n");
  let markerLine: string | null = null;
  let i = 0;
  if (DAEMON_MARKER_RE.test(lines[0] ?? "")) {
    let j = 1;
    while (j < lines.length && isBlank(lines[j])) j++;
    if (DAEMON_HEADER_RE.test(lines[j] ?? "")) {
      markerLine = lines[0].replace(/\r$/, "");
      i = j;
    }
  }
  const w = WEBUI_HEADER_RE.exec(lines[i]);
  const d = w ? null : DAEMON_HEADER_RE.exec(lines[i]);
  if (!w && !d) return null;
  const hasRest = lines.length > i + 1;
  return {
    timestamp: (w ?? d)![1],
    leadId: w ? w[2] : leadFromTail(daemonTail(lines.slice(i))),
    marker: markerLine,
    rest: hasRest ? `\n${lines.slice(i + 1).join("\n")}` : "",
  };
}

/**
 * Rewrite a proposed block into logged form: `## ADR-<NNNN> [<timestamp>]
 * <leadId>` + body. A daemon entry keeps its decisionKey marker as the first
 * body line (the key is otherwise lost with the `## Proposed … — <key>`
 * header) exactly as `<!-- decisionKey: … -->`. Byte-preserving beyond that.
 * The rewritten header line is LF-terminated (legacy behaviour).
 */
export function toLoggedBlock(proposedBlock: string, number: number): string {
  const h = headerOf(proposedBlock);
  if (!h || h.leadId === null) {
    const first = proposedBlock.split("\n", 1)[0];
    throw new Error(
      `toLoggedBlock: block does not start with a proposed-entry header: ${first.slice(0, 80)}`,
    );
  }
  const adr = `ADR-${String(number).padStart(4, "0")}`;
  const marker = h.marker !== null ? `\n${h.marker}` : "";
  return `## ${adr} [${h.timestamp}] ${h.leadId}${marker}${h.rest}`;
}
