/*
 * orgDecisionsApi.ts — the `decisions-proposed.md` parser + the countersign
 * fetcher (FR-01.71 (F), iterate-2026-09-06-decisions-proposed-
 * countersign). Split into its own module — same rationale as
 * `orgRegisterApi.ts` — separate from `orgApi.ts`, whose line count is
 * additionally bound by `org-schema-sync.test.ts`'s hardcoded `CLIENT_PATH`.
 *
 * `parseProposedDecisions` mirrors `server/src/external/org/decisions-lock.ts`'s
 * `PROPOSED_HEADER_RE` / `parseProposedEntries` header format — CLAUDE.md
 * rule 7 forbids importing that module directly (cross-package import), so
 * this is a deliberate, documented mirror of the SAME opaque, header-
 * delimited contract that route already parses (`## [<ISO-8601 timestamp>]
 * <lead-id>`, body opaque up to the next header or EOF), not a
 * reinterpretation of it. `decisions-lock.ts` treats the body as fully
 * opaque; this mirror additionally scrapes a labelled `- **Evidence:**`
 * line for display ONLY (best-effort — a body without one still renders,
 * just without an evidence line), never for anything the countersign call
 * itself depends on (that only ever needs `timestamp` + `leadId`, taken
 * from the header).
 */
import { ApiError } from "./externalApi";
import { ORG_API, fetchOrgFileText } from "./orgApi";

// Both header forms (W1) - verbatim mirror of server `proposed-entry-format.ts`
// (CLAUDE.md rule 7: no cross-package import). Contract:
// `docs/org-proposed-entry-contract.md`.
const WEBUI_HEADER_RE = /^## \[([^\]]+)\] (.+?)\r?$/;
const DAEMON_HEADER_RE = /^## Proposed (\S+) — (.+?)\r?$/;
const DAEMON_MARKER_RE = /^<!--\s*decisionKey:\s*.*?\s*-->\r?$/;
const FENCE_LINE_RE = /^⟦SHIPWRIGHT-FENCE:[0-9a-f]+⟧\r?$/;
const LEAD_BULLET_RE = /^-[ \t]*\*\*Lead:\*\*[ \t]*(.+?)\r?$/;
const EVIDENCE_BULLET_RE = /^-[ \t]*\*\*Evidence:\*\*[ \t]*(.+?)\r?$/;

const isBlank = (line: string): boolean => line.trim() === "";

/** Lines inside a fenced region (a fence counts only when its identical
 *  closing line exists later) - header lines there are quoted text. */
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

/** Lines after a daemon entry's closing fence line (whole block if no fence). */
function daemonTail(blockLines: string[]): string[] {
  const open = blockLines.findIndex((l) => FENCE_LINE_RE.test(l));
  if (open === -1) return blockLines;
  const close = blockLines.indexOf(blockLines[open], open + 1);
  return close === -1 ? [] : blockLines.slice(close + 1); // unclosed fence = corrupt: no identity
}

function firstBullet(lines: string[], re: RegExp): string | null {
  for (const l of lines) {
    const m = re.exec(l);
    if (m) return m[1].trim();
  }
  return null;
}

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

const EVIDENCE_LINE_RE = /^-\s*\*\*Evidence:\*\*\s*(.+?)\r?$/m;

function extractEvidence(block: string, daemonForm: boolean): string | null {
  if (daemonForm) {
    // Only the bullet AFTER the closing fence counts - never one in the quote.
    return firstBullet(daemonTail(block.split("\n")), EVIDENCE_BULLET_RE);
  }
  const m = EVIDENCE_LINE_RE.exec(block);
  return m ? m[1].trim() : null;
}

/** Parses `decisions-proposed.md`'s raw text into its header-delimited
 *  entries, in file order. An empty/whitespace-only file yields `[]` — the
 *  panel's "no decisions waiting" state, never a parse error. */
export function parseProposedDecisions(raw: string): ProposedDecisionEntry[] {
  const lines = raw.split("\n");
  const fenced = fencedLineSet(lines);
  interface Head { startLine: number; headerLine: number; timestamp: string; leadId: string | null }
  const heads: Head[] = [];
  lines.forEach((line, idx) => {
    if (fenced.has(idx)) return;
    const w = WEBUI_HEADER_RE.exec(line);
    if (w) {
      heads.push({ startLine: idx, headerLine: idx, timestamp: w[1], leadId: w[2] });
      return;
    }
    const d = DAEMON_HEADER_RE.exec(line);
    if (d) {
      let m = idx - 1;
      while (m >= 0 && isBlank(lines[m])) m--;
      const marker = m >= 0 && !fenced.has(m) && DAEMON_MARKER_RE.test(lines[m]);
      heads.push({ startLine: marker ? m : idx, headerLine: idx, timestamp: d[1], leadId: null });
    }
  });

  const out: ProposedDecisionEntry[] = [];
  heads.forEach((h, i) => {
    const endLine = heads[i + 1]?.startLine ?? lines.length;
    const block = lines.slice(h.startLine, endLine).join("\n");
    const daemonForm = h.leadId === null;
    // Daemon form: the FIRST `- **Lead:**` bullet after the closing fence line
    // (a quote above or an evidence pointer below can never win). No bullet =
    // no identity, so the entry is not listed.
    const leadId = h.leadId ?? firstBullet(daemonTail(block.split("\n")), LEAD_BULLET_RE);
    if (leadId === null) return;
    out.push({
      timestamp: h.timestamp,
      leadId,
      block,
      body: lines.slice(h.headerLine + 1, endLine).join("\n"),
      evidence: extractEvidence(block, daemonForm),
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
  | { ok: true; alreadyCountersigned: boolean; number: number; adr: string }
  | { ok: false; reason: "not-found" }
  | { ok: false; reason: "duplicate"; count: number };

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
): Promise<CountersignResult> {
  const r = await fetch(`${ORG_API}/decisions/countersign`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ timestamp, leadId }),
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
  if (!r.ok) {
    const code = typeof body.error === "string" ? body.error : `http_${r.status}`;
    throw new ApiError(code, r.status, body);
  }
  return {
    ok: true,
    alreadyCountersigned: body.alreadyCountersigned === true,
    number: typeof body.number === "number" ? body.number : 0,
    adr: typeof body.adr === "string" ? body.adr : "",
  };
}
