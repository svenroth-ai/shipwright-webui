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
  WEBUI_HEADER_RE, DAEMON_HEADER_RE, DAEMON_MARKER_RE, LEAD_ID_RE, LEAD_BULLET_RE, ISO_TIMESTAMP_RE,
  isBlank, stripBom, scanFences, structuralInside, daemonTail, isCanonicalDaemonBlock, firstBullet,
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

/** Parse `decisions-proposed.md` into its header-delimited entries. Fail closed:
 *  an entry is listed (hence countersignable) only when nothing structural can
 *  be forged around it - see the contract doc. */
export function parseProposedEntries(raw: string): ProposedEntry[] {
  const lines = raw.split("\n");
  const lineStarts: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineStarts.push(offset);
    offset += line.length + 1;
  }
  lines[0] = stripBom(lines[0]); // analysis only; offsets above stay raw
  const { fenced, ambiguousOwners, poisonFrom } = scanFences(lines, "proposed");

  interface Head { startLine: number; timestamp: string; leadFromHeader: string | null; markerOwned: boolean; barrier: boolean }
  const heads: Head[] = [];
  lines.forEach((line, idx) => {
    // Ambiguous region / dangling opener: nothing inside or after is trusted.
    if (fenced.has(idx) || idx >= poisonFrom) return;
    const w = WEBUI_HEADER_RE.exec(line);
    const d = w ? null : DAEMON_HEADER_RE.exec(line);
    if (!w && !d) return;
    let m = idx - 1;
    while (m >= 0 && isBlank(lines[m])) m--;
    const markerOwned = m >= 0 && !fenced.has(m) && DAEMON_MARKER_RE.test(lines[m]);
    heads.push({
      startLine: markerOwned ? m : idx,
      timestamp: (w ?? d)![1],
      leadFromHeader: w ? w[2] : null,
      markerOwned,
      barrier: ambiguousOwners.has(idx),
    });
  });

  const out: ProposedEntry[] = [];
  // A marker-less WebUI-form header right after a marker-owned entry that did NOT
  // list (non-canonical / ambiguous: e.g. a decisionKey carrying a newline and a
  // header) is part of that damage: unlisted, and so is every WebUI header after it
  // until a marker-owned entry lists again.
  let tainted = false;
  heads.forEach((h, i) => {
    const startIndex = lineStarts[h.startLine];
    const next = heads[i + 1];
    const endIndex = next ? lineStarts[next.startLine] : raw.length;
    const block = raw.slice(startIndex, endIndex);
    const blockLines = (startIndex === 0 ? stripBom(block) : block).split("\n");
    const owned = h.markerOwned || h.leadFromHeader === null;
    if (h.barrier) { tainted = true; return; } // ambiguous owner: a barrier that is never listed
    let leadId: string | null;
    if (owned) {
      // exact renderEntry shape only, ISO timestamp, a countersignable lead id
      tainted = true; // reset below once this entry is listed
      if (!isCanonicalDaemonBlock(blockLines) || !ISO_TIMESTAMP_RE.test(h.timestamp)) return;
      leadId = h.leadFromHeader ?? leadFromTail(daemonTail(blockLines));
      if (leadId === null || !LEAD_ID_RE.test(leadId)) return;
      tainted = false;
    } else {
      if (tainted || structuralInside(blockLines, 1, blockLines.length)) return;
      leadId = h.leadFromHeader;
    }
    out.push({ timestamp: h.timestamp, leadId: leadId as string, block, startIndex, endIndex });
  });
  return out;
}

/** Header of a single proposed block (first line, or marker + header). */
function headerOf(block: string): { timestamp: string; leadId: string | null; marker: string | null; rest: string } | null {
  const lines = stripBom(block).split("\n");
  let markerLine: string | null = null;
  let i = 0;
  if (DAEMON_MARKER_RE.test(lines[0] ?? "")) {
    let j = 1;
    while (j < lines.length && isBlank(lines[j])) j++;
    if (DAEMON_HEADER_RE.test(lines[j] ?? "") || WEBUI_HEADER_RE.test(lines[j] ?? "")) {
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

/** The body of a proposed block (everything below its header line, the marker excluded), or `null` when the block
 *  has no proposed-entry header. A fenced entry's proposed line comes from `proposalFacts`; this is the text of an
 *  entry WITHOUT a fence (the old WebUI form), which has no single line of its own. */
export function proposedBodyOf(block: string): string | null {
  const h = headerOf(block);
  return h === null ? null : h.rest;
}

/** A whole-entry log block (`toLoggedBlock`) with the operator's countersign note appended as its own list item,
 *  after one blank line. No note = the block unchanged (byte for byte). `decision-residue.ts` strips exactly this
 *  suffix again when it compares a log block with a still-listed entry. */
export function withLoggedNote(loggedBlock: string, note: string | null): string {
  if (note === null) return loggedBlock;
  return `${loggedBlock.replace(/\s+$/, "")}\n\n- Note: ${note}\n\n`;
}
