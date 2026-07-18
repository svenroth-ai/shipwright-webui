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

/** Prose disposition can be long (a real one runs to a paragraph) — bound it. */
const MAX_DISPOSITION_CHARS = 2000;

/**
 * The internal passes have no machine-readable record TODAY. Naming the
 * follow-up in the note keeps the gap traceable instead of mysterious.
 */
const INTERNAL_NOTE =
  "The internal review passes do not yet write a machine-readable record, " +
  "so this run's result cannot be shown. This is a known gap, not a clean result.";

function internalRow(reviewType: "code" | "doubt"): ReviewRow {
  return {
    reviewType,
    status: "unavailable",
    findingsCount: null,
    findings: [],
    provider: null,
    completedAt: null,
    disposition: null,
    note: INTERNAL_NOTE,
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
  return MARKERS.map((m) => path.join(dir, m.file));
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
 * All four review types for `runId`, always in contract order (AC4: the four
 * types are ALWAYS represented; missing ones say so explicitly).
 */
export function readReviewState(projectRoot: string, runId: string): ReviewLookup {
  const rows: ReviewRow[] = [];
  let hasRecord = false;
  let sawUnreadable = false;

  if (!isSafeRunId(runId)) {
    return {
      rows: [
        unreadableRow("plan", "This run could not be identified."),
        internalRow("code"),
        internalRow("doubt"),
        unreadableRow("external_code", "This run could not be identified."),
      ],
      hasRecord: false,
      // `true`, NOT false: a run id we cannot validate is a detected INTEGRITY
      // FAULT, not an absence. Reporting `false` here would erase the fault
      // this branch just found — `buildReviewArtifact` matches
      // `!hasRecord && !sawUnreadable` and would HIDE the artifact, throwing
      // away the four rows constructed directly above and leaving the user with
      // Spec/Requirement/Commit rendering normally while Review silently
      // vanished. That is exactly the absent-data-hides-an-artifact shape this
      // slice exists to prevent (internal code review, MEDIUM).
      sawUnreadable: true,
    };
  }

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
  rows.push(byType.get("plan")!, internalRow("code"), internalRow("doubt"), byType.get("external_code")!);
  return { rows, hasRecord, sawUnreadable };
}
