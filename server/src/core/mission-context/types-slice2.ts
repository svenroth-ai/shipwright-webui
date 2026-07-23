/*
 * core/mission-context/types-slice2.ts — the Tests · Review · Decisions wire
 * shapes (campaign 2026-07-18-mission-artifacts, Slice 2; CONTRACT §6 rows 3–5).
 *
 * Its OWN module rather than more lines in `types.ts`: that file is at 203 LOC
 * against a 300 ceiling, and these three artifacts carry the richest detail
 * shapes in the feature. `types.ts` imports the union members from here, so
 * there is still exactly one `ArtifactDescriptor`.
 *
 * These are the SoT the client mirrors verbatim (ADR-080 / DO-NOT #7 — the two
 * workspaces never import each other), so the producers in `traceability.ts` /
 * `review-state.ts` import the shapes from here rather than declaring twins.
 */

import type { ArtifactBase, MissionTests } from "./types.js";

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

/** How a test file moved in the run's own commit. */
export type TestChangeKind = "added" | "modified" | "removed";

/**
 * A requirement a test covers, WITH its fold provenance.
 *
 * `mappedFrom` is set only when the manifest resolved a folded source tag to a
 * surviving parent — a test tagged `covers(FR-01.44)` filed under `FR-01.28`
 * renders "mapped from FR-01.44" (Slice-2 AC2, covers monorepo `trg-5f6a4f74`).
 */
export interface TestFrRef {
  frId: string;
  mappedFrom: string | null;
}

export interface TestRow {
  /** Repo-relative POSIX path. */
  path: string;
  kind: TestChangeKind;
  /**
   * `unit` / `e2e` / … — from the manifest when it knows the file, otherwise
   * inferred from the path, otherwise null. A REMOVED file is never in the
   * manifest (that is what removal means), so its layer is always inferred.
   */
  layer: string | null;
  frs: TestFrRef[];
  /** Test cases the manifest records for this file; null when unknown. */
  caseCount: number | null;
}

export interface TestsArtifact extends ArtifactBase {
  kind: "tests";
  detail: {
    type: "tests";
    /**
     * Pass/total the run RECORDED (`work_completed.tests`, the same shape
     * `MissionContext.tests` carries) — the reliable CORE signal, present for
     * 182/374 real rows even when the worktree flow shipped `commit:""` and no
     * per-file diff could be built. `null` only when the run recorded no counts
     * at all. The `rows` below are the ENRICHMENT: they exist only when a real
     * commit diff resolved, and are never a precondition for showing the card.
     */
    results: MissionTests | null;
    rows: TestRow[];
    counts: { added: number; modified: number; removed: number };
    /** Aggregate per layer, e.g. `[{layer:"unit",count:4},{layer:"e2e",count:1}]`. */
    byLayer: { layer: string; count: number }[];
    /** True when the row list was capped — the UI must say so, not imply completeness. */
    truncated: boolean;
    /**
     * `unavailable` means the traceability manifest could not be read, so the
     * requirement links on these rows are MISSING, not empty. The rows
     * themselves are still real (they come from git).
     */
    manifestStatus: "ok" | "unavailable";
  } | null;
}

// ---------------------------------------------------------------------------
// Review
// ---------------------------------------------------------------------------

/**
 * The five passes. `self` was added once the producer began recording it
 * (`iterate-2026-07-22-mission-review-record`): at trivial and small complexity
 * the Self-Review is the ONLY review that runs, so omitting it showed nothing
 * for the commonest case.
 */
export type ReviewType = "self" | "plan" | "code" | "doubt" | "external_code";

/**
 * `not_run`        — a record EXISTS saying the pass did not run.
 * `not_applicable` — it did not APPLY at this size or change shape. Kept
 *                    distinct from `not_run`: "we chose to skip it" and "the
 *                    rules never asked for it" are different facts, and the
 *                    disposition should not have to re-explain which one it was.
 * `unavailable`    — no readable record either way. NOT the same as "clean".
 */
export type ReviewStatus = "completed" | "not_run" | "not_applicable" | "unavailable";

/**
 * How well the reviewer's own output could be itemized.
 *
 * `unstructured` is the load-bearing one: the review RAN and its prose could not
 * be split into findings, so `findingsCount` is 0 for a review that may have
 * found plenty. Rendering that as "0 issues" is the fabrication the whole
 * artifact exists to prevent, which is why this is a field the UI can branch on
 * rather than a sentence buried in `note`.
 */
export type ReviewParseStatus = "structured" | "partial" | "unstructured";

/** Where a row came from — the UI's honesty copy differs per source. */
export type ReviewSource = "record" | "marker";

export interface ReviewFinding {
  severity: string | null;
  /** The finding text itself. */
  title: string;
  /** `path/to/file.ts:42`, pre-joined server-side; null when not located. */
  location: string | null;
  suggestion: string | null;
}

export interface ReviewRow {
  reviewType: ReviewType;
  status: ReviewStatus;
  /** Real count; null when there is no readable record, or none yet. */
  findingsCount: number | null;
  /**
   * Per-finding detail. Populated from the per-run review record; ALWAYS empty
   * on the `marker` path, which records a COUNT only. The UI must never render
   * `[]` as "no findings were found" — see `source`.
   */
  findings: ReviewFinding[];
  provider: string | null;
  completedAt: string | null;
  /** The reviewer's own prose disposition, when one was recorded. */
  disposition: string | null;
  /** Plain-language reason the status is not `completed`. */
  note: string | null;
  /** Null on the marker path and for internal passes, which are not parsed. */
  parseStatus: ReviewParseStatus | null;
  source: ReviewSource;
  /** The finding list was capped — the UI must say so, not imply completeness. */
  truncated: boolean;
}

export interface ReviewArtifact extends ArtifactBase {
  kind: "review";
  detail: {
    type: "reviews";
    /** ALWAYS all five types, in contract order (AC4). */
    rows: ReviewRow[];
  } | null;
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

/**
 * Where a decision was read from — and therefore how far along it is.
 *
 * `decision_log` — aggregated at release time, so it HAS a sequential ADR number.
 * `drop`         — written at the iterate's F3 as
 *                  `decision-drops/<run_id>_NNN.json`. Real, recorded, and NOT
 *                  yet numbered: `/shipwright-changelog` assigns the number when
 *                  it folds the drop into the log. Measured 2026-07-19, this is
 *                  the state of EVERY unreleased run in this repo (18 of 18).
 */
export type DecisionSource = "decision_log" | "drop";

export interface DecisionEntryView {
  /**
   * `ADR-070` once a release aggregation numbered it; **null** while the
   * decision lives only as a drop. Never fabricated — a plausible
   * next-in-sequence number is one a reader could cite.
   */
  adrId: string | null;
  title: string;
  /** The ADR block's own Markdown — the SECTION, never the whole 639 KB log. */
  markdown: string;
  source: DecisionSource;
}

export interface DecisionsArtifact extends ArtifactBase {
  kind: "decisions";
  detail: {
    type: "decisions";
    entries: DecisionEntryView[];
    truncated: boolean;
    /**
     * Drop files that matched this run but could not be read or validated. A
     * half-written drop must not take the artifact down, but it must not vanish
     * either — the UI states the count.
     */
    malformedCount: number;
  } | null;
}
