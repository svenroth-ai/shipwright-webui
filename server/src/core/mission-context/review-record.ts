/*
 * core/mission-context/review-record.ts — the per-run REVIEW RECORD reader.
 *
 * ── WHAT CHANGED ───────────────────────────────────────────────────────────
 * Slice 2 shipped Review from the two `external_*review_state.json` markers and
 * represented the internal self / code / doubt passes explicitly as unavailable,
 * because no clean source existed (see `review-state.ts` for that decision and
 * why guessing one would have been worse). The producer side has since closed
 * the gap: every iterate now writes
 *
 *     .shipwright/planning/iterate/<run_id>/reviews.json
 *
 * keyed by review type, carrying INDIVIDUAL FINDINGS, immutable once a pass has
 * answered. This module reads it. `review-state.ts` keeps the marker path
 * untouched as the fallback for the runs that predate the record.
 *
 * ── absent vs. invalid, and why it is a discriminated result ───────────────
 * Only a VERIFIED MISSING FILE may fall back to the markers. Bad JSON, a record
 * naming another run, an unknown schema version, a count that disagrees with its
 * own list — each is an integrity fault, and answering one by quietly reading
 * the weaker source would present a corrupt record as a review history. So the
 * reader returns `valid | absent | invalid` and never a bare null.
 *
 * ── validation mirrors the producer's own ──────────────────────────────────
 * The two repositories never import each other (DO-NOT #7), so this re-states
 * the producer's schema check rather than sharing it. That duplication is the
 * price of the boundary; the protection against drift is the fixture in
 * `test/fixtures/reviews-record-real.json`, copied verbatim from real producer
 * output rather than written here.
 */

import { statSync } from "node:fs";
import path from "node:path";

import { readBoundedFile } from "./fs-read.js";
import { pathGuard, realPathGuard } from "../path-guard.js";
import { isSafeRunId } from "./pointer.js";
import type {
  ReviewFinding,
  ReviewParseStatus,
  ReviewRow,
  ReviewStatus,
  ReviewType,
} from "./types-slice2.js";

/** Contract order — `self` first: it is the one review that always runs. */
const REVIEW_TYPES: ReviewType[] = ["self", "plan", "code", "doubt", "external_code"];

const RECORD_SCHEMA_VERSION = 1;

/**
 * 2 MB. The marker bound (256 KB) was tuned for a few hundred bytes; a real
 * 46-finding record measures 46 KB, so that ceiling was one noisy run away from
 * turning a healthy record into a false integrity fault.
 */
const MAX_RECORD_BYTES = 2 * 1024 * 1024;

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

/** Bound what one row can push into a 420px panel; disclosed, never silent. */
const MAX_FINDINGS_PER_ROW = 50;
const SEVERITIES = new Set(["high", "medium", "low"]);

const PENDING_NOTE =
  "This review has not answered yet — the run recorded no result for it.";

export type ReviewRecordResult =
  | { kind: "valid"; rows: ReviewRow[] }
  | { kind: "absent" }
  | { kind: "invalid"; reason: string };

/** Absolute path of the record — also probed for `sourceRev` so a late write refreshes. */
export function reviewRecordPath(projectRoot: string, runId: string): string | null {
  if (!isSafeRunId(runId)) return null;
  return path.join(projectRoot, ".shipwright", "planning", "iterate", runId, "reviews.json");
}

function str(value: unknown, max = MAX_TEXT): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim().slice(0, max)
    : null;
}

function invalid(reason: string): ReviewRecordResult {
  return { kind: "invalid", reason };
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
 * Map one producer entry. A `pending` type becomes `unavailable` with a count of
 * `null`: nobody has answered, and rendering that as a completed review with
 * zero findings is the exact "0 reads as clean" failure this artifact exists to
 * prevent.
 */
function toRow(reviewType: ReviewType, entry: Record<string, unknown>): ReviewRow | string {
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

/**
 * Read + validate the run's review record.
 *
 * Validation is total on purpose: a record that passes here is one the UI may
 * render without re-checking, and `run_id` is verified against the REQUESTED run
 * because a stale or copied file sitting at a valid guarded path would otherwise
 * be presented as this run's review history.
 */
export function readReviewRecord(projectRoot: string, runId: string): ReviewRecordResult {
  if (!isSafeRunId(runId)) return invalid("run id is not safe to resolve");

  const rel = [".shipwright", "planning", "iterate", runId, "reviews.json"].join("/");
  const guard = pathGuard(projectRoot, rel);
  if (!guard.ok) return invalid("the record path could not be resolved safely");

  // ENOENT — and ONLY ENOENT — is an absence the markers may answer.
  //
  // `existsSync` cannot make that distinction: it swallows EVERY error and
  // returns false, so an unreadable record (EACCES, a broken symlink, a
  // directory where a file belongs) would report "absent" and silently hand the
  // question to the weaker source. That is the downgrade this whole reader
  // exists to prevent, so the errno is inspected instead.
  try {
    const stats = statSync(guard.absolute);
    if (!stats.isFile()) return invalid("the record path is not a file");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") return { kind: "absent" };
    return invalid(`the record could not be inspected (${code ?? "unknown error"})`);
  }

  // The documented pair: pathGuard is string-only, so realPathGuard is what
  // refuses a symlink pointing out of the project (DO-NOT #10).
  if (!realPathGuard(projectRoot, guard.absolute).ok) {
    return invalid("the record resolves outside the project");
  }

  const read = readBoundedFile(guard.absolute, MAX_RECORD_BYTES);
  if (!read) return invalid("the record could not be read within its size bound");

  let parsed: unknown;
  try {
    parsed = JSON.parse(read.text);
  } catch {
    return invalid("the record is not valid JSON");
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return invalid("the record is not an object");
  }

  const record = parsed as Record<string, unknown>;
  if (record.schema_version !== RECORD_SCHEMA_VERSION) {
    return invalid(
      `record schema_version ${String(record.schema_version)} is not one this reader understands`,
    );
  }
  if (record.run_id !== runId) {
    return invalid(`the record names run ${String(record.run_id)}, not ${runId}`);
  }

  const reviews = record.reviews;
  if (!reviews || typeof reviews !== "object" || Array.isArray(reviews)) {
    return invalid("the record has no reviews object");
  }
  const byType = reviews as Record<string, unknown>;

  const unknown = Object.keys(byType).filter((k) => !REVIEW_TYPES.includes(k as ReviewType));
  if (unknown.length > 0) return invalid(`the record has unknown review type(s): ${unknown.join(", ")}`);

  const rows: ReviewRow[] = [];
  for (const reviewType of REVIEW_TYPES) {
    const entry = byType[reviewType];
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      return invalid(`the record is missing the ${reviewType} review`);
    }
    const row = toRow(reviewType, entry as Record<string, unknown>);
    if (typeof row === "string") return invalid(row);
    rows.push(row);
  }

  return { kind: "valid", rows };
}
