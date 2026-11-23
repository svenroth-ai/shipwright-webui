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
const LEAD_BULLET_RE = /^-[ \t]*\*\*Lead:\*\*[ \t]*(.+?)\r?$/;

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

/** Line indexes that lie inside a fenced region (open line, text and close
 *  line). A fence only counts when its identical closing line exists later. */
function fencedLineSet(lines: string[]): Set<number> {
  const fenced = new Set<number>();
  let i = 0;
  while (i < lines.length) {
    if (FENCE_LINE_RE.test(lines[i])) {
      const close = lines.indexOf(lines[i], i + 1);
      if (close !== -1) {
        for (let k = i; k <= close; k++) fenced.add(k);
        i = close + 1;
        continue;
      }
    }
    i++;
  }
  return fenced;
}

/** Lines of a daemon entry that come after its closing fence line (or the
 *  whole block when it has no fence). */
function daemonTail(blockLines: string[]): string[] {
  const open = blockLines.findIndex((l) => FENCE_LINE_RE.test(l));
  if (open === -1) return blockLines;
  const close = blockLines.indexOf(blockLines[open], open + 1);
  return close === -1 ? blockLines : blockLines.slice(close + 1);
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
  const fenced = fencedLineSet(lines);

  interface Head { startLine: number; timestamp: string; leadFromHeader: string | null }
  const heads: Head[] = [];
  lines.forEach((line, idx) => {
    if (fenced.has(idx)) return;
    const w = WEBUI_HEADER_RE.exec(line);
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
    const leadId = h.leadFromHeader ?? leadFromTail(daemonTail(block.split("\n")));
    // A daemon entry with no Lead bullet has no identity the countersign
    // route could address: it is not listed. Its text is still part of the
    // byte range ending where the next HEADER starts, but no listed entry
    // owns it, so countersigning another entry never moves or removes it.
    if (leadId === null) return;
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
