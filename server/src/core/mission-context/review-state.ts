/*
 * core/mission-context/review-state.ts — the REVIEW source (CONTRACT §9.1,
 * decided in Slice 2; campaign 2026-07-18-mission-artifacts).
 *
 * ── THE DECISION (Sven, 2026-07-18) ────────────────────────────────────────
 * Ship Review from the sources that already have a CLEAN CONTRACT — the
 * per-iterate `external_*review_state.json` markers written by
 * `shared/scripts/checks/mark-review-state.py` — and represent the INTERNAL
 * self / code / doubt passes explicitly as unavailable. The alternative
 * (scraping the raw session JSONL for reviewer subagent output) has no stable
 * contract; guessing one would fabricate review history, which is the single
 * worst thing this artifact could do. The monorepo follow-up that gives the
 * internal passes a real machine-readable record is filed as `trg-74ec44b8`.
 *
 * ── WHY "unavailable" AND NOT "not run" ────────────────────────────────────
 * They are DIFFERENT facts and the §6 state model exists to keep them apart:
 *
 *   not_run      a marker EXISTS and says the pass was skipped (opt-out,
 *                below threshold, missing keys). We know it did not run.
 *   unavailable  we have no readable record either way. The pass may well
 *                have run — we cannot see it.
 *
 * Rendering an unreadable pass as "clean" (or as a silent absence) would turn a
 * data-integrity gap into a false assurance. That is the exact lie the state
 * model was introduced to kill, and it is worth the extra enum value.
 *
 * MEASURED ON THIS REPO 2026-07-18: 55 marker files, ONE uniform shape
 * (`status`, `timestamp`, `provider`, `findings_count`, `self_review_fallback_ran`,
 * `reason`, `review_mode`). Note what it does NOT contain: a per-finding array.
 * So `findings[]` is always empty here and `findingsCount` is the real number —
 * the UI must show the count and say the details are not recorded, never
 * render an empty list as "no findings".
 */

import { existsSync } from "node:fs";
import path from "node:path";

import { readBoundedFile } from "./fs-read.js";
import { readReviewRecord, reviewRecordPath } from "./review-record.js";
import { pathGuard } from "../path-guard.js";
import { isSafeRunId } from "./pointer.js";
import type { ReviewRow, ReviewType } from "./types-slice2.js";

/** Marker basenames, mapped to the review type each one records. */
const MARKERS: { file: string; type: Extract<ReviewType, "plan" | "external_code"> }[] = [
  { file: "external_review_state.json", type: "plan" },
  { file: "external_code_review_state.json", type: "external_code" },
];

/** A marker is a few hundred bytes; 256 KB bounds a corrupt one generously. */
const MAX_MARKER_BYTES = 256 * 1024;

/** Contract order — `self` first; it is the one review that always runs. */
const REVIEW_TYPE_ORDER: ReviewType[] = ["self", "plan", "code", "doubt", "external_code"];

const RECORD_INTEGRITY_NOTE =
  "This run's review record exists but could not be read. That is a data " +
  "problem, not a clean result.";

/** Prose disposition can be long (a real one runs to a paragraph) — bound it. */
const MAX_DISPOSITION_CHARS = 2000;

/**
 * The internal passes have no machine-readable record TODAY. Naming the
 * follow-up in the note keeps the gap traceable instead of mysterious.
 */
const INTERNAL_NOTE =
  "The internal review passes do not yet write a machine-readable record, " +
  "so this run's result cannot be shown. This is a known gap, not a clean result.";

function internalRow(reviewType: "self" | "code" | "doubt"): ReviewRow {
  return {
    reviewType,
    status: "unavailable",
    findingsCount: null,
    findings: [],
    provider: null,
    completedAt: null,
    disposition: null,
    note: INTERNAL_NOTE,
    parseStatus: null,
    source: "marker",
    truncated: false,
  };
}

function unreadableRow(reviewType: ReviewType, note: string): ReviewRow {
  return {
    reviewType,
    status: "unavailable",
    findingsCount: null,
    findings: [],
    provider: null,
    completedAt: null,
    disposition: null,
    note,
    parseStatus: null,
    source: "marker",
    truncated: false,
  };
}

function asStr(v: unknown, max = 200): string | null {
  return typeof v === "string" && v.trim().length > 0 ? v.trim().slice(0, max) : null;
}

/** Directory holding a run's review markers. */
export function reviewStateDir(projectRoot: string, runId: string): string {
  return path.join(projectRoot, ".shipwright", "planning", "iterate", runId);
}

/** Absolute marker paths — used for `sourceRev` probing so a late review refreshes. */
export function reviewStatePaths(projectRoot: string, runId: string): string[] {
  if (!isSafeRunId(runId)) return [];
  const dir = reviewStateDir(projectRoot, runId);
  const recordPath = reviewRecordPath(projectRoot, runId);
  return [
    ...(recordPath ? [recordPath] : []),
    ...MARKERS.map((m) => path.join(dir, m.file)),
  ];
}

type MarkerRead =
  | { kind: "row"; row: ReviewRow }
  | { kind: "absent" }
  | { kind: "unreadable"; row: ReviewRow };

function readMarker(projectRoot: string, runId: string, marker: (typeof MARKERS)[number]): MarkerRead {
  const rel = [".shipwright", "planning", "iterate", runId, marker.file].join("/");
  const guard = pathGuard(projectRoot, rel);
  if (!guard.ok) {
    return { kind: "unreadable", row: unreadableRow(marker.type, "This review record could not be read safely.") };
  }
  if (!existsSync(guard.absolute)) return { kind: "absent" };

  const read = readBoundedFile(guard.absolute, MAX_MARKER_BYTES);
  if (!read) {
    return { kind: "unreadable", row: unreadableRow(marker.type, "This review record could not be read.") };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(read.text);
  } catch {
    return { kind: "unreadable", row: unreadableRow(marker.type, "This review record is not readable.") };
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return { kind: "unreadable", row: unreadableRow(marker.type, "This review record is not readable.") };
  }

  const o = parsed as Record<string, unknown>;
  const raw = asStr(o.status, 64);
  const completed = raw === "completed";
  const count = typeof o.findings_count === "number" && Number.isFinite(o.findings_count)
    ? Math.max(0, Math.trunc(o.findings_count))
    : null;

  return {
    kind: "row",
    row: {
      reviewType: marker.type,
      status: completed ? "completed" : "not_run",
      // A count only means something for a review that actually ran.
      findingsCount: completed ? count : null,
      findings: [],
      provider: asStr(o.provider, 120),
      completedAt: asStr(o.timestamp, 64),
      disposition: asStr(o.reason, MAX_DISPOSITION_CHARS),
      // A completed review whose count we could NOT read needs a note of its
      // own. Leaving it null let the row render as a bare "ran", which a
      // reader completes as "…and found nothing" (internal code review).
      note: completed
        ? count == null
          ? "This review ran; its findings count was not recorded."
          : null
        : notRunNote(raw),
      parseStatus: null,
      source: "marker",
      truncated: false,
    },
  };
}

/** Turn the marker's machine status into something a non-expert can read. */
function notRunNote(raw: string | null): string {
  if (!raw) return "This review was recorded as not run.";
  if (raw === "missing_keys") return "Not run — the external reviewer was not configured.";
  if (raw.startsWith("skipped_")) {
    return `Not run — ${raw.slice("skipped_".length).replace(/_/g, " ")}.`;
  }
  return `Not run — recorded as “${raw}”.`;
}

export interface ReviewLookup {
  rows: ReviewRow[];
  /** At least one marker carried a real, readable record. */
  hasRecord: boolean;
  /** A marker existed but could not be read — an integrity signal, not absence. */
  sawUnreadable: boolean;
}

/**
 * All five review types for `runId`, in contract order.
 *
 * **Precedence: the per-run record wins.** Since
 * `iterate-2026-07-22-mission-review-record` the producer writes
 * `.shipwright/planning/iterate/<run_id>/reviews.json` with real per-finding
 * detail for all five passes, so the markers are now the FALLBACK — kept
 * byte-for-byte as they were, because 64 existing runs depend on that behaviour.
 *
 * A record that is present but INVALID does not fall through. Answering a
 * corrupt record with the weaker source would present a data-integrity fault as
 * a review history; it is reported as unreadable instead, which the §6 state
 * model renders as "currently unavailable".
 */
export function readReviewState(projectRoot: string, runId: string): ReviewLookup {
  // Hoisted out of the marker path: the record read below rejects an unsafe run
  // id too, so the marker path's own guard became unreachable AND its surviving
  // branch would have claimed a record "exists but could not be read" for a file
  // nobody ever probed.
  if (!isSafeRunId(runId)) {
    return {
      rows: REVIEW_TYPE_ORDER.map((t) => unreadableRow(t, "This run could not be identified.")),
      hasRecord: false,
      sawUnreadable: true,
    };
  }

  const record = readReviewRecord(projectRoot, runId);
  if (record.kind === "valid") {
    return {
      rows: record.rows,
      // A record the producer JUST materialized has all five types `pending`,
      // which map to `unavailable`. Reporting `hasRecord: true` for it made the
      // artifact appear mid-run saying "No review was recorded as having run" —
      // worse than the honest "not written yet" it replaced. `hasRecord` means
      // "a source carried an actual answer", on this path as on the marker one.
      hasRecord: record.rows.some((r) => r.status !== "unavailable"),
      sawUnreadable: false,
    };
  }
  if (record.kind === "invalid") {
    return {
      rows: REVIEW_TYPE_ORDER.map((t) => unreadableRow(t, RECORD_INTEGRITY_NOTE)),
      hasRecord: false,
      // An integrity fault is a DETECTED problem, not an absence: `false` here
      // would make buildReviewArtifact hide the artifact entirely and throw the
      // fault away.
      sawUnreadable: true,
    };
  }
  return readMarkerState(projectRoot, runId);
}

/**
 * The pre-record path, unchanged: the two `external_*review_state.json` markers,
 * with the internal passes represented explicitly as unavailable. Reached only
 * when no record exists — i.e. runs that predate it.
 */
function readMarkerState(projectRoot: string, runId: string): ReviewLookup {
  const rows: ReviewRow[] = [];
  let hasRecord = false;
  let sawUnreadable = false;


  const byType = new Map<ReviewType, ReviewRow>();
  for (const marker of MARKERS) {
    const r = readMarker(projectRoot, runId, marker);
    if (r.kind === "row") {
      hasRecord = true;
      byType.set(marker.type, r.row);
    } else if (r.kind === "unreadable") {
      sawUnreadable = true;
      byType.set(marker.type, r.row);
    } else {
      byType.set(
        marker.type,
        unreadableRow(marker.type, "No record of this review was found for this run."),
      );
    }
  }

  // Contract order: plan · code · doubt · external_code.
  rows.push(
    internalRow("self"),
    byType.get("plan")!,
    internalRow("code"),
    internalRow("doubt"),
    byType.get("external_code")!,
  );
  return { rows, hasRecord, sawUnreadable };
}
