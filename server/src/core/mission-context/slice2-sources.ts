/*
 * core/mission-context/slice2-sources.ts — one entry point that reads the three
 * Slice-2 sources and returns their descriptors
 * (campaign 2026-07-18-mission-artifacts).
 *
 * Exists so `resolver.ts` grows by a handful of lines rather than by three
 * source reads: that file sits at the 300-LOC ceiling and this slice must not
 * ratchet it.
 *
 * `slice2RevPaths` is the OTHER half of this module and it is not optional
 * bookkeeping — it is the fix for the exact bug S1's review caught. The resolver
 * caches on a fingerprint of its source files, so any input NOT listed in the
 * rev is frozen at whatever it was when the entry was first built. A review
 * marker written minutes after the run finished, or a regenerated traceability
 * manifest, would never appear. Every file read below is therefore listed there,
 * including the ones that do not exist yet (they fingerprint as `absent`, so
 * their later CREATION changes the rev and invalidates the entry).
 */

import { buildDecisionsArtifact } from "./artifacts-decisions.js";
import { buildReviewArtifact, buildTestsArtifact } from "./artifacts-slice2.js";
import { decisionDropsDir, dropFilePaths } from "./decision-drops.js";
import { readRunDecisionRecord, decisionLogPath } from "./decisions.js";
import type { EventLookup } from "./iterate-record.js";
import { readReviewState, reviewStatePaths } from "./review-state.js";
import { readChangedTestFiles } from "./tests-diff.js";
import { readTraceabilityIndex, traceabilityPath } from "./traceability.js";
import type { DecisionsArtifact, ReviewArtifact, TestsArtifact } from "./types-slice2.js";
import { defaultGit, type GitRunner } from "./worktree-roots.js";

/**
 * Every file the Slice-2 artifacts depend on, for `computeSourceRev`.
 *
 * The run's COMMIT is deliberately absent: a sha is immutable, so the diff it
 * produces cannot change. The files below can and do.
 */
export function slice2RevPaths(projectRoot: string, runId: string): string[] {
  return [
    traceabilityPath(projectRoot),
    decisionLogPath(projectRoot),
    // The drops DIRECTORY, present or not. Registering it while it does not yet
    // exist is the load-bearing half: it fingerprints `absent`, so the moment an
    // iterate's F3 CREATES it the rev changes and the cache lets go. Omitting it
    // would rebuild the exact bug S1 shipped — a cache that could never refresh
    // because its input was outside the rev.
    decisionDropsDir(projectRoot),
    // …and each matching drop FILE. A directory's mtime moves when an entry is
    // added or removed, but NOT when a file's content is rewritten, so the
    // directory alone would freeze an edited drop.
    ...dropFilePaths(projectRoot, runId),
    ...reviewStatePaths(projectRoot, runId),
  ];
}

export interface Slice2Input {
  projectRoot: string;
  runId: string;
  events: EventLookup;
  /** The run's recorded commit sha, when it recorded one. */
  commit: string | null;
  git?: GitRunner;
}

export interface Slice2Result {
  /** Tests · Review · Decisions, in CONTRACT §6 order. */
  artifacts: [TestsArtifact, ReviewArtifact, DecisionsArtifact];
  /**
   * False when the response must NOT be cached.
   *
   * git's answer is not a statted file, so it cannot participate in
   * `sourceRev`. A TRANSIENT git failure (index.lock, a GC race, a briefly
   * unreachable object) would therefore pin Tests at `unavailable` until some
   * unrelated source file happened to change. It degrades toward a visible
   * "currently unavailable" rather than a false "no tests", so this is
   * staleness and not a safety break — but it is trivially avoidable
   * (internal code review, FIX-IF-CHEAP).
   *
   * `bad_commit` deliberately stays CACHEABLE: "this run recorded no commit" is
   * a stable fact about the run, not a transient fault.
   */
  cacheable: boolean;
}

/** Tests · Review · Decisions, in CONTRACT §6 order. */
export async function buildSlice2Artifacts(input: Slice2Input): Promise<Slice2Result> {
  const { projectRoot, runId, events, commit } = input;
  const git = input.git ?? defaultGit;

  // Only diff once the run actually completed — a mid-run git call is waste,
  // and `buildTestsArtifact` reports `not_yet_created` for that case anyway.
  const diff =
    events.status === "found"
      ? await readChangedTestFiles(projectRoot, commit, git)
      : ({ status: "unavailable", reason: "bad_commit" } as const);

  // The manifest is only needed to ENRICH real diff rows, so skip the 0.9 MB
  // read entirely when there are none.
  const needsManifest = diff.status === "ok" && diff.files.length > 0;
  const index = needsManifest
    ? readTraceabilityIndex(projectRoot)
    : ({ status: "unavailable", reason: "missing" } as const);

  return {
    artifacts: [
      buildTestsArtifact({ events, diff, index }),
      buildReviewArtifact(readReviewState(projectRoot, runId)),
      // drops ∪ decision_log, deduplicated by run_id (the log wins). A run's ADR
      // exists ONLY as a drop between its F3 and the next release aggregation,
      // which on this repo is the state of every unreleased run.
      buildDecisionsArtifact(readRunDecisionRecord(projectRoot, runId), events),
    ],
    cacheable: !(diff.status === "unavailable" && diff.reason === "git_failed"),
  };
}
