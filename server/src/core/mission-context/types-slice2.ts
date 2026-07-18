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

import type { ArtifactBase } from "./types.js";

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

/** The four passes the contract pins. */
export type ReviewType = "plan" | "code" | "doubt" | "external_code";

/**
 * `not_run`     — a record EXISTS saying the pass did not run.
 * `unavailable` — no readable record either way. NOT the same as "clean".
 */
export type ReviewStatus = "completed" | "not_run" | "unavailable";

export interface ReviewFinding {
  severity: string | null;
  title: string;
}

export interface ReviewRow {
  reviewType: ReviewType;
  status: ReviewStatus;
  /** Real count from the record; null when there is no readable record. */
  findingsCount: number | null;
  /**
   * Per-finding detail. Always empty from today's sources — the marker records
   * a COUNT only. The UI must never render `[]` as "no findings were found"
   * (see review-state.ts for the §9.1 decision and follow-up `trg-74ec44b8`).
   */
  findings: ReviewFinding[];
  provider: string | null;
  completedAt: string | null;
  /** The reviewer's own prose disposition, when one was recorded. */
  disposition: string | null;
  /** Plain-language reason the status is not `completed`. */
  note: string | null;
}

export interface ReviewArtifact extends ArtifactBase {
  kind: "review";
  detail: {
    type: "reviews";
    /** ALWAYS all four types, in contract order (AC4). */
    rows: ReviewRow[];
  } | null;
}

// ---------------------------------------------------------------------------
// Decisions
// ---------------------------------------------------------------------------

export interface DecisionEntryView {
  adrId: string;
  title: string;
  /** The ADR block's own Markdown — the SECTION, never the whole 639 KB log. */
  markdown: string;
}

export interface DecisionsArtifact extends ArtifactBase {
  kind: "decisions";
  detail: {
    type: "decisions";
    entries: DecisionEntryView[];
    truncated: boolean;
  } | null;
}
