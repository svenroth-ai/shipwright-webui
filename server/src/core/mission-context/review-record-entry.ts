/*
 * core/mission-context/review-record-entry.ts — ONE producer entry becomes ONE
 * wire row, or a reason it cannot.
 *
 * Split out of `review-record.ts` (iterate-2026-07-31-review-record-tolerant-reader)
 * along the seam the change itself exposed. The two modules answer two different
 * questions and only one of them just changed:
 *
 *   review-record.ts   is this FILE a record for this run?  (path, size, JSON,
 *                      version, run identity, which passes it carries)
 *   review-record-entry.ts  is this ENTRY a row?             (this module)
 *
 * That the reader now accepts review types it has never heard of is a statement
 * about the first question ONLY. An unrecognised pass is mapped by the SAME
 * function, against the SAME vocabularies, as a pinned one — which is why
 * `toRow` takes a plain `string` and not a member of a closed union. Tolerance
 * lives at the key; this file stays total.
 */

import type {
  ReviewFinding,
  ReviewParseStatus,
  ReviewRow,
  ReviewStatus,
} from "./types-slice2.js";

const MAX_TEXT = 4000;
const MAX_SHORT = 400;

/**
 * Producer status → wire status. A MAP rather than a set-plus-cast: the cast
 * severed the only link between the runtime vocabulary and the `ReviewStatus`
 * union, so a sixth producer status would have flowed through onto the wire and
 * hit the client's exhaustive `reviewStatusWord` switch, which returns undefined
 * and renders a review with NO status word at all. This way it is a compile
 * error instead.
 */
const PRODUCER_STATUS: Record<string, ReviewStatus | undefined> = {
  // "nobody has answered yet" is not a result — it is the absence of one.
  pending: "unavailable",
  completed: "completed",
  not_run: "not_run",
  not_applicable: "not_applicable",
};

const PARSE_STATUSES = new Set(["structured", "partial", "unstructured"]);

/** Terminal statuses the producer guarantees carry a reason. */
const NEEDS_DISPOSITION = new Set(["not_run", "not_applicable"]);

/**
 * Bound what one row can push into a 420px panel; disclosed, never silent —
 * `truncated` is set and `findingsCount` keeps the FULL number, so the summary
 * arithmetic stays right and the panel says it is showing fewer.
 *
 * Sized when the list was five rows fixed. The list is now bounded at 32, so the
 * aggregate ceiling is 1600 rather than 250 (Stage-3 doubt, D7). Left as it is:
 * the per-row cap is about one row's share of the panel, which did not change,
 * and every row past the first few is scrolled to rather than seen.
 */
const MAX_FINDINGS_PER_ROW = 50;
const SEVERITIES = new Set(["high", "medium", "low"]);

const PENDING_NOTE =
  "This review has not answered yet — the run recorded no result for it.";

function str(value: unknown, max = MAX_TEXT): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().slice(0, max)
    : null;
}

/**
 * `file` + `line` joined once, server-side, so the client never formats a
 * location. A file with no line is still a location worth showing.
 */
function location(file: unknown, line: unknown): string | null {
  const filePath = str(file, MAX_SHORT);
  if (!filePath) return null;
  return typeof line === "number" && Number.isFinite(line) && line > 0
    ? `${filePath}:${Math.trunc(line)}`
    : filePath;
}

function toFinding(raw: unknown): ReviewFinding | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const o = raw as Record<string, unknown>;
  const title = str(o.finding);
  if (!title) return null;
  const severity = typeof o.severity === "string" && SEVERITIES.has(o.severity)
    ? o.severity
    : null;
  return {
    severity,
    title,
    location: location(o.file, o.line),
    suggestion: str(o.suggestion),
  };
}

/**
 * How many review entries sit under record-level keys the caller does not read
 * (Stage-3 doubt, D2).
 *
 * Recognising an entry BY SHAPE is this module's knowledge, which is why the
 * walk lives here. Not hypothetical: the producer parks its Stage-1 gate in a
 * sibling `gates` object TODAY and no webui code has ever looked at it, so a run
 * whose spec gate found five things — two of them blocking — summarises as if
 * they did not exist. Shape, not the name `gates`, so the NEXT sibling is
 * disclosed the day it appears rather than the day somebody notices.
 */
export function unreadPassCount(
  record: Record<string, unknown>,
  knownKeys: ReadonlySet<string>,
): number {
  let count = 0;
  for (const [key, value] of Object.entries(record)) {
    if (knownKeys.has(key)) continue;
    if (!value || typeof value !== "object" || Array.isArray(value)) continue;
    for (const entry of Object.values(value as Record<string, unknown>)) {
      if (entry && typeof entry === "object" && "review_type" in entry) count += 1;
    }
  }
  return count;
}

/**
 * A pass this build has never heard of whose ENTRY does not validate.
 *
 * Tolerance is per-key; without this, FAILURE would be per-record — one unknown
 * word in one unrecognised pass would replace five perfectly-parsed rows with an
 * integrity fault. The priors differ by object: for a PINNED pass an unknown
 * field value really is more likely corruption, but for a pass this build does
 * not know, it is more likely the same evolution the key tolerance exists for,
 * and the costs are asymmetric — calling evolution corruption destroys five
 * healthy rows, calling corruption evolution costs one row already unknown
 * (Stage-3 doubt, D5).
 *
 * The row is PRESENT and explicitly unreadable, never dropped, and
 * `buildReviewArtifact` already folds an `unavailable` row into "their result is
 * unknown". A malformed KEY is still a record-level fault: the key is the row's
 * identity, and there is no honest row to degrade to without one.
 */
export function unreadableStranger(reviewType: string): ReviewRow {
  return {
    reviewType,
    status: "unavailable",
    findingsCount: null,
    findings: [],
    provider: null,
    completedAt: null,
    disposition: null,
    note: "This run recorded this review pass in a form this version cannot read, so its result is not shown here.",
    parseStatus: null,
    source: "record",
    truncated: false,
  };
}

/**
 * Map one producer entry. A `pending` type becomes `unavailable` with a count of
 * `null`: nobody has answered, and rendering that as a completed review with
 * zero findings is the exact "0 reads as clean" failure this artifact exists to
 * prevent.
 *
 * Returns the row, or a STRING naming the first thing wrong with the entry —
 * which the caller reports as an integrity fault for the whole record. That is
 * deliberate for an unrecognised pass too: not knowing what a pass is called is
 * evolution, but a pass whose own fields contradict each other is corruption,
 * and answering corruption with a partial record would be the quiet lie.
 */
export function toRow(reviewType: string, entry: Record<string, unknown>): ReviewRow | string {
  if (entry.review_type !== reviewType) {
    return `reviews.${reviewType}.review_type is ${String(entry.review_type)}`;
  }
  const status = typeof entry.status === "string" ? entry.status : "";
  const wireStatus = PRODUCER_STATUS[status];
  if (!wireStatus) {
    return `reviews.${reviewType}.status ${String(entry.status)} is not a known status`;
  }
  const rawFindings = entry.findings;
  if (!Array.isArray(rawFindings)) return `reviews.${reviewType}.findings is not a list`;
  if (entry.findings_count !== rawFindings.length) {
    return `reviews.${reviewType}.findings_count disagrees with its own list`;
  }

  const findings: ReviewFinding[] = [];
  for (const raw of rawFindings) {
    const finding = toFinding(raw);
    if (!finding) return `reviews.${reviewType} has a finding with no text`;
    findings.push(finding);
  }

  // An UNKNOWN parse_status is a schema fault, not something to normalize to
  // null: silently dropping it would turn "we do not know how well this parsed"
  // into "it parsed fine".
  const parseStatusRaw = entry.parse_status;
  if (parseStatusRaw !== null && parseStatusRaw !== undefined
      && !(typeof parseStatusRaw === "string" && PARSE_STATUSES.has(parseStatusRaw))) {
    return `reviews.${reviewType}.parse_status ${String(parseStatusRaw)} is not a known value`;
  }
  const parseStatus = (typeof parseStatusRaw === "string" ? parseStatusRaw : null) as
    | ReviewParseStatus
    | null;

  const disposition = str(entry.disposition, 2000);
  if (NEEDS_DISPOSITION.has(status) && !disposition) {
    return `reviews.${reviewType} is ${status} but records no reason`;
  }

  // The producer guarantees an unstructured parse itemized NOTHING. A record
  // claiming otherwise is internally inconsistent, and rendering it would show a
  // finding list under a caveat saying the findings could not be listed.
  if (parseStatus === "unstructured" && findings.length > 0) {
    return `reviews.${reviewType} is unstructured yet carries itemized findings`;
  }

  if (findings.length > MAX_FINDINGS_PER_ROW) {
    findings.length = MAX_FINDINGS_PER_ROW;
  }

  const pending = status === "pending";
  return {
    reviewType,
    status: wireStatus,
    findingsCount: pending ? null : Number(entry.findings_count),
    findings,
    truncated: Number(entry.findings_count) > findings.length,
    provider: str(entry.provider, 120),
    completedAt: str(entry.completed_at, 64),
    disposition,
    note: pending ? PENDING_NOTE : null,
    parseStatus,
    source: "record",
  };
}
