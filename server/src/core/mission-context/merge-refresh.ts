/*
 * core/mission-context/merge-refresh.ts — keep the merge state live across
 * resolver cache hits (CONTRACT §5.3 asymmetric TTL).
 *
 * THE BUG THIS FIXES (internal code review, HIGH). The resolver caches its
 * whole response keyed on a revision built from source-file mtimes. After a run
 * finalizes, every one of those files goes quiescent — so `rev` stops changing,
 * every later poll is a cache hit, and the cached commit artifact keeps
 * whatever `merge` value it was built with. In practice that is "pending",
 * frozen forever, because the squash lands on origin/main AFTER the run
 * finishes. The asymmetric TTL in merge-check.ts (`merged` cached forever,
 * `pending` re-checked) was unreachable dead code, CONTRACT §11's required
 * "pending → merged after the TTL re-check" behaviour was impossible, and AC2's
 * merge state was correct only by luck.
 *
 * Merge is the ONLY time-varying field in the response, so rather than
 * weakening the cache (which correctly avoids re-reading unchanged files) we
 * re-derive just this one field on every call — but only while it is
 * NON-TERMINAL. Once `merged` is observed it is terminal and we stop asking.
 *
 * Cost is bounded: `checkSquashMerged` has its own TTL cache, so a re-check
 * inside the TTL is a map lookup, not a git spawn.
 */

import { refreshCommitMerge } from "./artifacts-commit.js";
import {
  checkSquashMerged,
  extractPrMarker,
  readOriginSlug,
  type MergeCheckDeps,
} from "./merge-check.js";
import type { GitRunner } from "./worktree-roots.js";
import type { CommitArtifact, MissionContext } from "./types.js";

export interface MergeRefreshDeps {
  git?: GitRunner;
  merge?: MergeCheckDeps;
}

/**
 * Return `context` with a freshly-checked merge state, or the SAME object when
 * nothing could change (no commit artifact, not yet available, or already
 * terminal) so callers pay nothing on the common path.
 */
export function refreshMerge(
  context: MissionContext,
  projectRoot: string,
  transcript: string,
  deps: MergeRefreshDeps = {},
): MissionContext {
  const commit = context.artifacts.find(
    (a): a is CommitArtifact => a.kind === "commit",
  );
  if (!commit || commit.state !== "available" || !commit.detail) return context;
  // `merged` is terminal — never re-ask, never regress it to pending.
  if (commit.detail.merge === "merged") return context;

  const marker = extractPrMarker(transcript, readOriginSlug(projectRoot, deps.git));
  if (!marker) return context;

  const merge = checkSquashMerged(projectRoot, marker.number, {
    git: deps.git,
    ...deps.merge,
  });
  const refreshed = refreshCommitMerge(commit, merge, marker);
  if (refreshed === commit) return context;

  return {
    ...context,
    artifacts: context.artifacts.map((a) => (a.kind === "commit" ? refreshed : a)),
  };
}
