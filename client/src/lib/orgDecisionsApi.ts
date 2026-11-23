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
  // Mirror of the server: a marker-less WebUI header after a marker-owned entry that
  // did not list is part of that damage and stays unlisted.
  let tainted = false;
  heads.forEach((h, i) => {
    const endLine = heads[i + 1]?.startLine ?? lines.length;
    const blockLines = lines.slice(h.startLine, endLine);
    const block = blockLines.join("\n");
    const owned = h.markerOwned || h.leadFromHeader === null;
    if (h.barrier) { tainted = true; return; } // ambiguous owner: never listed
    let leadId: string | null;
    if (owned) {
      // exact renderEntry shape only, ISO timestamp, a countersignable lead id
      tainted = true; // reset below once this entry is listed
      if (!isCanonicalDaemonBlock(blockLines) || !ISO_TIMESTAMP_RE.test(h.timestamp)) return;
      leadId = h.leadFromHeader ?? firstBullet(daemonTail(blockLines), LEAD_BULLET_RE);
      if (leadId === null || !LEAD_ID_RE.test(leadId)) return;
      tainted = false;
    } else {
      if (tainted || structuralInside(blockLines, 1, blockLines.length)) return;
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
  return out;
}

/** `GET /api/org/file?path=decisions-proposed.md`, parsed. Same 404-on-
 *  missing contract as {@link fetchOrgFileText} — a missing file is a real
 *  state the panel shows, not an error to swallow into "no decisions". */
export async function fetchProposedDecisions(): Promise<ProposedDecisionEntry[]> {
  const raw = await fetchOrgFileText("decisions-proposed.md");
  return parseProposedDecisions(raw);
}

export type CountersignResult =
  | { ok: true; alreadyCountersigned: boolean; number: number; adr: string; /** the operator's own line was logged */ edited: boolean; /** this request named a line other than the logged one (already countersigned) */ loggedLineDiffers?: boolean }
  | { ok: false; reason: "line-rejected"; code: string }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "duplicate"; count: number }
  | { ok: false; reason: "reject-pending" };

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
): Promise<CountersignResult> {
  const r = await fetch(`${ORG_API}/decisions/countersign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(line === undefined ? { timestamp, leadId } : { timestamp, leadId, line }),
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
    return { ok: false, reason: "duplicate", count: typeof body.count === "number" ? body.count : 0 };
  }
  if (r.status === 409 && body.error === "reject_pending") return { ok: false, reason: "reject-pending" };
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
