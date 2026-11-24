/*
 * orgDecisionsApi.ts — the `decisions-proposed.md` parser + the countersign
 * fetcher (FR-01.71 (F), iterate-2026-09-06-decisions-proposed-
 * countersign). Split into its own module — same rationale as
 * `orgRegisterApi.ts` — separate from `orgApi.ts`, whose line count is
 * additionally bound by `org-schema-sync.test.ts`'s hardcoded `CLIENT_PATH`.
 *
 * `parseProposedDecisions` is a deliberate, documented mirror (CLAUDE.md rule
 * 7 forbids importing server code) of `server/src/external/org/
 * proposed-entry-format.ts`: BOTH entry header forms (`## [<ts>] <lead>` and
 * the leadwright daemon's `## Proposed <ts> — <key>` + decisionKey marker),
 * identity `(timestamp, leadId)`, quote-injection rules. Contract:
 * `docs/org-proposed-entry-contract.md`; drift guard:
 * `orgDecisionsApi.daemon-header.test.ts` (same pinned sample + regex sync).
 * This mirror additionally scrapes the `- **Evidence:**` bullet for display
 * ONLY; countersign needs just `timestamp` + `leadId`.
 */
import { ApiError } from "./externalApi";
import { ORG_API, fetchOrgFileText } from "./orgApi";

import {
  WEBUI_HEADER_RE, DAEMON_HEADER_RE, DAEMON_MARKER_RE, LEAD_ID_RE, LEAD_BULLET_RE, EVIDENCE_BULLET_RE, ISO_TIMESTAMP_RE,
  isBlank, stripBom, scanFences, structuralInside, daemonTail, isCanonicalDaemonBlock, firstBullet,
} from "./orgProposedGrammar";

export interface ProposedDecisionEntry {
  timestamp: string;
  leadId: string;
  /** Full block text (header line + body) — kept for anything that needs
   *  the header, e.g. re-deriving `body`. */
  block: string;
  /** `block` with its header line stripped — what the UI renders, so the
   *  identity (already shown in the row's own summary line) isn't repeated
   *  verbatim inside the body. */
  body: string;
  /** Best-effort scrape of a `- **Evidence:** <pointer>` body line; `null`
   *  when the body carries none (the body is opaque, not required to have
   *  one). */
  evidence: string | null;
}

const EVIDENCE_LINE_RE = /^-[ \t]*\*\*Evidence:\*\*([^\r\n]*)\r?$/m;

function extractEvidence(block: string, daemonForm: boolean): string | null {
  if (daemonForm) {
    // Only the bullet AFTER the closing fence counts - never one in the quote.
    return firstBullet(daemonTail(block.split("\n")), EVIDENCE_BULLET_RE) || null; // empty value = no Evidence label
  }
  const m = EVIDENCE_LINE_RE.exec(block);
  return m ? m[1].trim() || null : null;
}

/** Parses `decisions-proposed.md`'s raw text into its header-delimited
 *  entries, in file order. An empty/whitespace-only file yields `[]` — the
 *  panel's "no decisions waiting" state, never a parse error. */
export function parseProposedDecisions(raw: string): ProposedDecisionEntry[] {
  return parseProposedDecisionsDetailed(raw).entries;
}

/** Candidate entries the parser dropped (fail closed): how many, and the lead ids that could be read from them.
 *  Never any content of a skipped entry. */
export interface SkippedEntries {
  count: number;
  leadIds: string[];
}

export interface ProposedDecisionsResult {
  entries: ProposedDecisionEntry[];
  skipped: SkippedEntries;
}

/** Same listing as `parseProposedDecisions`, plus what was NOT listed (ambiguous fence, damaged or non-canonical
 *  entry, structural injection, a dangling fence and the header-looking lines after it). Read-only signal. */
export function parseProposedDecisionsDetailed(raw: string): ProposedDecisionsResult {
  const lines = stripBom(raw).split("\n");
  const { fenced, ambiguousOwners, poisonFrom } = scanFences(lines, "proposed");
  interface Head { startLine: number; headerLine: number; timestamp: string; leadFromHeader: string | null; markerOwned: boolean; barrier: boolean }
  const heads: Head[] = [];
  lines.forEach((line, idx) => {
    if (fenced.has(idx) || idx >= poisonFrom) return; // ambiguous region: nothing inside or after is trusted
    const w = WEBUI_HEADER_RE.exec(line);
    const d = w ? null : DAEMON_HEADER_RE.exec(line);
    if (!w && !d) return;
    let m = idx - 1;
    while (m >= 0 && isBlank(lines[m])) m--;
    const markerOwned = m >= 0 && !fenced.has(m) && DAEMON_MARKER_RE.test(lines[m]);
    heads.push({
      startLine: markerOwned ? m : idx,
      headerLine: idx,
      timestamp: (w ?? d)![1],
      leadFromHeader: w ? w[2] : null,
      markerOwned,
      barrier: ambiguousOwners.has(idx),
    });
  });

  const out: ProposedDecisionEntry[] = [];
  let skippedCount = 0;
  const skippedLeads = new Set<string>();
  // Header-looking lines after a dangling fence opener are untrusted and unlisted: each counts as skipped.
  for (let idx = poisonFrom; idx < lines.length; idx++) {
    if (WEBUI_HEADER_RE.test(lines[idx]) || DAEMON_HEADER_RE.test(lines[idx])) skippedCount++;
  }
  const skip = (lead: string | null) => {
    skippedCount++;
    if (lead !== null && LEAD_ID_RE.test(lead)) skippedLeads.add(lead);
  };
  // Mirror of the server: a marker-less WebUI header after a marker-owned entry that
  // did not list is part of that damage and stays unlisted.
  let tainted = false;
  heads.forEach((h, i) => {
    const endLine = heads[i + 1]?.startLine ?? lines.length;
    const blockLines = lines.slice(h.startLine, endLine);
    const block = blockLines.join("\n");
    const owned = h.markerOwned || h.leadFromHeader === null;
    if (h.barrier) { tainted = true; skip(h.leadFromHeader ?? firstBullet(daemonTail(blockLines), LEAD_BULLET_RE)); return; } // ambiguous owner: never listed
    let leadId: string | null;
    if (owned) {
      // exact renderEntry shape only, ISO timestamp, a countersignable lead id
      tainted = true; // reset below once this entry is listed
      const lead = h.leadFromHeader ?? firstBullet(daemonTail(blockLines), LEAD_BULLET_RE);
      if (!isCanonicalDaemonBlock(blockLines) || !ISO_TIMESTAMP_RE.test(h.timestamp)) { skip(lead); return; }
      leadId = lead;
      if (leadId === null || !LEAD_ID_RE.test(leadId)) { skip(null); return; }
      tainted = false;
    } else {
      if (tainted || structuralInside(blockLines, 1, blockLines.length)) { skip(h.leadFromHeader); return; }
      leadId = h.leadFromHeader;
    }
    out.push({
      timestamp: h.timestamp,
      leadId: leadId as string,
      block,
      body: lines.slice(h.headerLine + 1, endLine).join("\n"),
      evidence: extractEvidence(block, owned),
    });
  });
  return { entries: out, skipped: { count: skippedCount, leadIds: [...skippedLeads].sort() } };
}

/** `GET /api/org/file?path=decisions-proposed.md`, parsed. Same 404-on-
 *  missing contract as {@link fetchOrgFileText} — a missing file is a real
 *  state the panel shows, not an error to swallow into "no decisions". */
export async function fetchProposedDecisions(): Promise<ProposedDecisionsResult> {
  const raw = await fetchOrgFileText("decisions-proposed.md");
  return parseProposedDecisionsDetailed(raw);
}

export type CountersignResult =
  | { ok: true; alreadyCountersigned: boolean; number: number; adr: string; /** the operator's own line was logged */ edited: boolean; /** this request named a line other than the logged one (already countersigned) */ loggedLineDiffers?: boolean }
  | { ok: false; reason: "line-rejected"; code: string }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "duplicate"; count: number; /** an earlier, different version of this proposal is already logged under this ADR */ loggedAdr?: string }
  | { ok: false; reason: "reject-pending" }
  /** The lead rewrote the entry since the operator opened it; nothing was written. */
  | { ok: false; reason: "entry-changed" }
  /** The lead audit file cannot be read or written; nothing was changed. */
  | { ok: false; reason: "audit-unwritable"; message: string; /** the entry is already in the log (only its audit record is missing): countersign again to finish */ adr?: string };

/**
 * `POST /api/org/decisions/countersign` — mirrors the secret-gated route's
 * contract exactly (same `performCountersign` core on the server, see
 * `routes/org-writes.ts`). Throws {@link ApiError} on every failure this
 * result shape doesn't itself carry — `timestamp_invalid`/`leadId_invalid`/
 * `timestamp_required`/`leadId_required` (400), `symlink_forbidden` (403).
 * The body is read exactly once — never call `decodeApiError` here, it
 * would re-read an already-consumed stream.
 */
export async function countersignDecision(
  timestamp: string,
  leadId: string,
  /** The operator's edited proposed line; omit to approve as proposed. */
  line?: string,
  /** Digest (`blockDigest`) of the entry block the operator saw; the server refuses when the entry changed since. */
  fingerprint?: string,
): Promise<CountersignResult> {
  const r = await fetch(`${ORG_API}/decisions/countersign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ timestamp, leadId, ...(line === undefined ? {} : { line }), ...(fingerprint === undefined ? {} : { fingerprint }) }),
  });
  let body: Record<string, unknown> = {};
  try {
    body = (await r.json()) as Record<string, unknown>;
  } catch {
    body = { error: `HTTP ${r.status}` };
  }
  if (r.status === 404) {
    return { ok: false, reason: "not-found" };
  }
  if (r.status === 409 && body.error === "duplicate_proposal_identity") {
    return { ok: false, reason: "duplicate", count: typeof body.count === "number" ? body.count : 0, ...(typeof body.loggedAdr === "string" ? { loggedAdr: body.loggedAdr } : {}) };
  }
  if (r.status === 409 && body.error === "reject_pending") return { ok: false, reason: "reject-pending" };
  if (r.status === 409 && body.error === "entry_changed") return { ok: false, reason: "entry-changed" };
  if (r.status === 409 && body.error === "audit_unwritable") return { ok: false, reason: "audit-unwritable", message: typeof body.message === "string" ? body.message : "The audit file of this lead cannot be used.", ...(body.logged === true && typeof body.adr === "string" ? { adr: body.adr } : {}) };
  if (r.status === 400 && typeof body.error === "string" && body.error.startsWith("line_")) {
    return { ok: false, reason: "line-rejected", code: body.error };
  }
  if (r.status === 400 && body.error === "edit_not_supported") return { ok: false, reason: "line-rejected", code: body.error };
  if (!r.ok) {
    const code = typeof body.error === "string" ? body.error : `http_${r.status}`;
    throw new ApiError(code, r.status, body);
  }
  return {
    ok: true,
    alreadyCountersigned: body.alreadyCountersigned === true,
    number: typeof body.number === "number" ? body.number : 0,
    adr: typeof body.adr === "string" ? body.adr : "",
    edited: body.edited === true,
    loggedLineDiffers: body.loggedLineDiffers === true,
  };
}
