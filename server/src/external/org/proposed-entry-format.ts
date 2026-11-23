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

import {
  WEBUI_HEADER_RE, DAEMON_HEADER_RE, DAEMON_MARKER_RE, LEAD_ID_RE, LEAD_BULLET_RE,
  isBlank, scanFences, daemonTail, isCanonicalDaemonBlock, firstBullet,
} from "./proposed-grammar.js";

export type { FenceFileKind } from "./proposed-grammar.js";
export { scanFences } from "./proposed-grammar.js";

export interface ProposedEntry {
  timestamp: string;
  leadId: string;
  /** Full block text (optional marker + header line + body), from this entry's
   *  first line up to the next entry's first line or EOF. Opaque. */
  block: string;
  startIndex: number;
  endIndex: number;
}

const leadFromTail = (lines: string[]): string | null => firstBullet(lines, LEAD_BULLET_RE);

/** Parse `decisions-proposed.md` into its header-delimited entries. */
export function parseProposedEntries(raw: string): ProposedEntry[] {
  const lines = raw.split("\n");
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  const { fenced, ambiguousOwners, poisonFrom } = scanFences(lines, "proposed");

  interface Head { startLine: number; timestamp: string; leadFromHeader: string | null; barrier: boolean }
  const heads: Head[] = [];
  lines.forEach((line, idx) => {
    // Ambiguous region / dangling opener: nothing inside or after is trusted.
    if (fenced.has(idx) || idx >= poisonFrom) return;
    const w = WEBUI_HEADER_RE.exec(line);
    // A WebUI-form header glued right under a daemon header is a decisionKey
    // that carried a newline, not an entry.
    if (w && idx > 0 && DAEMON_HEADER_RE.test(lines[idx - 1])) return;
    if (w) {
      heads.push({ startLine: idx, timestamp: w[1], leadFromHeader: w[2], barrier: false });
      return;
    }
    const d = DAEMON_HEADER_RE.exec(line);
    if (d) {
      let m = idx - 1;
      while (m >= 0 && isBlank(lines[m])) m--;
      const hasMarker = m >= 0 && !fenced.has(m) && DAEMON_MARKER_RE.test(lines[m]);
      heads.push({ startLine: hasMarker ? m : idx, timestamp: d[1], leadFromHeader: null, barrier: ambiguousOwners.has(idx) });
    }
  });

  const out: ProposedEntry[] = [];
  heads.forEach((h, i) => {
    const startIndex = lineStarts[h.startLine];
    const next = heads[i + 1];
    const endIndex = next ? lineStarts[next.startLine] : raw.length;
    const block = raw.slice(startIndex, endIndex);
    if (h.barrier) return; // ambiguous owner: a barrier that is never listed
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
