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

const PROPOSED_HEADER_RE = /^## \[([^\]]+)\] (.+?)\r?$/;

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

function extractEvidence(block: string): string | null {
  const m = EVIDENCE_LINE_RE.exec(block);
  return m ? m[1].trim() : null;
}

/** Parses `decisions-proposed.md`'s raw text into its header-delimited
 *  entries, in file order. An empty/whitespace-only file yields `[]` — the
 *  panel's "no decisions waiting" state, never a parse error. */
export function parseProposedDecisions(raw: string): ProposedDecisionEntry[] {
  const lines = raw.split("\n");
  const headerLineIdx: number[] = [];
  const matches: RegExpMatchArray[] = [];
  lines.forEach((line, idx) => {
    const m = PROPOSED_HEADER_RE.exec(line);
    if (m) {
      headerLineIdx.push(idx);
      matches.push(m);
    }
  });

  return headerLineIdx.map((lineIdx, i) => {
    const nextIdx = headerLineIdx[i + 1] ?? lines.length;
    const block = lines.slice(lineIdx, nextIdx).join("\n");
    const body = lines.slice(lineIdx + 1, nextIdx).join("\n");
    return {
      timestamp: matches[i][1],
      leadId: matches[i][2],
      block,
      body,
      evidence: extractEvidence(block),
    };
  });
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
