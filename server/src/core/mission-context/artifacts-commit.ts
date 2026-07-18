/*
 * core/mission-context/artifacts-commit.ts — the Commit descriptor
 * (CONTRACT §6 row 6 + §5.3 merge semantics).
 *
 * Split from artifacts.ts to keep both files within the size rule. This is the
 * only artifact whose content varies with TIME rather than with a source file,
 * which is why `refreshCommitMerge` lives here and is re-applied on every
 * resolver cache hit (see merge-refresh.ts).
 */

import type { ArtifactState, CommitArtifact, MergeState } from "./types.js";
import type { EventLookup } from "./iterate-record.js";

// ---------------------------------------------------------------------------
// Commit
// ---------------------------------------------------------------------------

function mergeSentence(merge: MergeState, prNumber: number | null): string {
  if (merge === "merged") return "Delivered — merged into the main line.";
  if (merge === "pending" && prNumber != null) return `Waiting to be merged (PR #${prNumber}).`;
  return "Committed; delivery not confirmed yet.";
}

export interface CommitInput {
  events: EventLookup;
  prNumber: number | null;
  prUrl: string | null;
  merge: MergeState;
}

/**
 * Re-apply a freshly-checked merge state to an ALREADY-BUILT commit artifact.
 *
 * Why this exists (internal code review, HIGH): the resolver's read-through
 * cache is keyed on source-file revisions, and after finalization every one of
 * those files goes quiescent. Returning the whole cached context therefore
 * froze `detail.merge` at whatever it was when the run finished — in practice
 * "pending" forever — and made the asymmetric TTL in merge-check.ts
 * unreachable dead code. The commit artifact is the ONLY time-varying part of
 * the response, so it is refreshed on every call while it is non-terminal.
 *
 * Returns the SAME object when nothing changed, so a caller can cheaply detect
 * a no-op and avoid rebuilding the context.
 */
export function refreshCommitMerge(
  artifact: CommitArtifact,
  merge: MergeState,
  marker: { number: number; url: string } | null,
): CommitArtifact {
  if (artifact.state !== "available" || !artifact.detail) return artifact;
  const prNumber = marker?.number ?? artifact.detail.prNumber;
  const prUrl = marker?.url ?? artifact.detail.prUrl;
  if (
    artifact.detail.merge === merge &&
    artifact.detail.prNumber === prNumber &&
    artifact.detail.prUrl === prUrl
  ) {
    return artifact;
  }
  const message = artifact.detail.message;
  return {
    ...artifact,
    summary: message
      ? `${message} ${mergeSentence(merge, prNumber)}`
      : mergeSentence(merge, prNumber),
    detail: { ...artifact.detail, merge, prNumber, prUrl },
  };
}

export function buildCommitArtifact(input: CommitInput): CommitArtifact {
  const { events, prNumber, prUrl, merge } = input;

  if (events.status === "unavailable") {
    return {
      kind: "commit",
      label: "Commit",
      state: "unavailable",
      summary: null,
      receipt: null,
      note: "The run record could not be read.",
      detail: null,
    };
  }

  const run = events.status === "found" ? events.run : null;
  // MEASURED: only 49 of 210 iterate rows carry a non-empty `commit`. An empty
  // string is NOT a commit — treat it as absent rather than rendering a blank sha.
  const commit = run?.commit && run.commit.trim().length > 0 ? run.commit.trim() : null;

  if (!run) {
    return {
      kind: "commit",
      label: "Commit",
      state: "not_yet_created",
      summary: null,
      receipt: null,
      detail: null,
    };
  }

  const message = run.summary ?? run.description ?? null;
  const shortSha = commit ? commit.slice(0, 7) : null;
  const receipt = shortSha ?? (prNumber != null ? `PR #${prNumber}` : null);

  // The run completed, so this artifact EXISTS even when the sha was not
  // recorded — the delivery story is still real (a PR link, a merge state).
  const state: ArtifactState = commit || prNumber != null ? "available" : "not_yet_created";
  if (state === "not_yet_created") {
    return { kind: "commit", label: "Commit", state, summary: null, receipt: null, detail: null };
  }

  return {
    kind: "commit",
    label: "Commit",
    state: "available",
    summary: message ? `${message} ${mergeSentence(merge, prNumber)}` : mergeSentence(merge, prNumber),
    receipt,
    detail: { type: "commit", commit, message, prNumber, prUrl, merge },
  };
}
