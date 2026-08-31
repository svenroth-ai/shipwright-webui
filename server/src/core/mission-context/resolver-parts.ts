/*
 * core/mission-context/resolver-parts.ts — pure helpers + the read-through
 * cache for the resolver.
 *
 * Split out of `resolver.ts` to keep both files within the size rule. These are
 * the revision / caching / response-shape primitives; the orchestration that
 * uses them stays in resolver.ts.
 */

import { createHash } from "node:crypto";
import { statSync } from "node:fs";

import { readBoundedFile } from "./fs-read.js";

import { MAX_DOC_BYTES } from "./worktree-roots.js";
import { recoverRunIdFromTranscript } from "./run-id-recovery.js";
import {
  MISSION_CONTEXT_SCHEMA_VERSION,
  type ArtifactDescriptor,
  type MissionContext,
} from "./types.js";

/**
 * mtime+size fingerprint of every source a response depends on.
 *
 * `paths` MUST include the iterate document and the per-run agent-doc, not just
 * the adopted spec + event log: editing only `mini-plan.md` would otherwise
 * leave the rev (and therefore the cache) unchanged, serving a stale planned
 * requirement and a stale document id (external code review, openai MEDIUM).
 */
export function computeSourceRev(paths: string[], extra: (string | number)[]): string {
  const h = createHash("sha256");
  for (const p of paths) {
    try {
      const st = statSync(p);
      h.update(`${p}:${st.mtimeMs}:${st.size}`);
    } catch {
      h.update(`${p}:absent`);
    }
  }
  for (const e of extra) h.update(`|${e}`);
  return h.digest("hex").slice(0, 16);
}

/**
 * Per-document fingerprint embedded in the opaque id.
 *
 * The context-wide rev is not enough for AC3 — it is derived from the adopted
 * spec + event log, so editing only the iterate document would leave it
 * unchanged and the detail endpoint would serve the NEW body as `ok`. This is
 * compared at read time, so a changed document reports `stale`.
 */
export function docFingerprint(absolute: string): string {
  try {
    const st = statSync(absolute);
    return `${st.size}:${st.mtimeMs}`;
  } catch {
    return "absent";
  }
}

/**
 * ALL SIX §6 artifacts, typed `unavailable` with one honest note.
 *
 * Used for the integrity cases (a pointer that failed validation, a worktree
 * git does not recognise): AC5 requires those to SHOW as unavailable rather
 * than fall through to a silent "nothing here". Every artifact kind must be
 * covered — omitting one would HIDE it on exactly the code path where the
 * integrity problem is worst.
 */
const UNAVAILABLE_KINDS: { kind: ArtifactDescriptor["kind"]; label: string }[] = [
  { kind: "spec", label: "Spec" },
  { kind: "requirement", label: "Requirement" },
  { kind: "tests", label: "Tests" },
  { kind: "review", label: "Review" },
  { kind: "decisions", label: "Decisions" },
  { kind: "commit", label: "Commit" },
];

export function unavailableArtifacts(note: string): ArtifactDescriptor[] {
  return UNAVAILABLE_KINDS.map(
    ({ kind, label }) =>
      ({
        kind,
        label,
        state: "unavailable",
        summary: null,
        receipt: null,
        note,
        detail: null,
      }) as ArtifactDescriptor,
  );
}

interface CacheEntry {
  rev: string;
  context: MissionContext;
}

/** Read-through cache keyed `{projectRoot, sessionUuid, runId}`, validated by `rev`. */
export const cache = new Map<string, CacheEntry>();
export const CACHE_CAP = 256;

/** Test-only: drop the module-level cache between cases. */
export function _clearResolverCache(): void {
  cache.clear();
}

/**
 * Memoizes a CONFIRMED SUPERSESSION for THIS transcript content against THIS
 * association (iterate-2026-08-31-mission-feed-gaps, scenario.ts rule 2b) —
 * not merely "already checked". Content-fingerprinted, not time-based: a poll
 * with no new transcript content is a guaranteed no-op, and the memo is
 * naturally invalidated the moment the association itself changes (a
 * different key) or the transcript grows (a different fingerprint).
 *
 * Caching the RESULT, not a checked/unchecked boolean, is load-bearing
 * (external code review, openai HIGH): the route persists a confirmed
 * supersession via `supersedeMissionContext` (association.ts) AFTER
 * `resolveMissionContext` returns, so a poll can legitimately land again with
 * the SAME stale `associationRunId` before that write lands (or if it fails
 * outright). A boolean-only memo would then return `null` on that second
 * poll — discarding an already-found answer and reverting the Mission
 * context from the newly recovered run back to the stale one.
 *
 * ONLY a non-null (confirmed, corroborated, provably-newer) recovery is ever
 * cached (external code review, openai MEDIUM): `recoverRunIdFromTranscript`
 * returns `null` for two different reasons — "no marker in this text" (a
 * purely textual fact, already covered by the SEPARATE negative-scan memo in
 * run-id-recovery.ts) and "marker found but corroboration failed", which that
 * module deliberately re-checks every poll because the project's own records
 * can gain the run LATER. Caching a `null` here for the second reason would
 * silently override that decision for the whole rule-2b class, so this memo
 * never stores one. Mirrors the negative-scan memo, kept separate because
 * this one also has to remember WHICH association it checked against, not
 * just whether a marker existed at all.
 */
const supersessionResult = new Map<string, { fingerprint: string; recovered: string }>();
const SUPERSESSION_CAP = 512;

/**
 * A full-content SHA-256, not length+suffix (external code review, openai
 * MEDIUM): two distinct bounded transcript snapshots can share both length
 * and final 256 characters while differing earlier in the tail — exactly
 * where an EARLIER `Run-ID:` footer could sit. A suffix-only fingerprint
 * would then replay a stale memoized answer for genuinely different content
 * instead of re-scanning. Hashing costs one pass over a string already read
 * into memory for the scan this memo exists to skip — cheap relative to what
 * it replaces.
 */
function supersessionFingerprint(transcript: string): string {
  return createHash("sha256").update(transcript).digest("hex");
}

/**
 * The memoized, CONFIRMED supersession for this (session, association,
 * transcript-content) triple — `undefined` when none is cached (either this
 * content was never checked, or it was checked and found nothing, which is
 * deliberately never memoized here; a scan is owed either way).
 */
export function supersessionMemoHit(
  sessionUuid: string,
  associationRunId: string,
  transcript: string,
): string | undefined {
  const entry = supersessionResult.get(`${sessionUuid}::${associationRunId}`);
  if (!entry || entry.fingerprint !== supersessionFingerprint(transcript)) return undefined;
  return entry.recovered;
}

/** Record this triple's CONFIRMED recovery, so the next unchanged poll reuses it instead of re-scanning. */
export function markSupersessionResult(
  sessionUuid: string,
  associationRunId: string,
  transcript: string,
  recovered: string,
): void {
  const key = `${sessionUuid}::${associationRunId}`;
  if (supersessionResult.size >= SUPERSESSION_CAP) supersessionResult.clear();
  supersessionResult.set(key, { fingerprint: supersessionFingerprint(transcript), recovered });
}

/** Test-only: drop the supersession-check memo between cases. */
export function _clearSupersessionMemo(): void {
  supersessionResult.clear();
}

/**
 * Builds the LAZY `recoverTranscriptRunId` thunk `detectScenario` calls for
 * both rule 5 (no association) and rule 2b (supersession check) — wiring the
 * throttle above around `recoverRunIdFromTranscript` in one place so the
 * orchestrator (resolver.ts) stays a one-line call site. `memoHit` is read at
 * BUILD time (this resolve's transcript/association snapshot), not
 * re-evaluated inside the thunk, since neither changes within one call.
 */
export function buildRecoveryThunk(
  projectRoot: string,
  sessionUuid: string,
  transcript: string,
  associationRunId: string | null,
): () => string | null {
  const memoHit =
    associationRunId !== null ? supersessionMemoHit(sessionUuid, associationRunId, transcript) : undefined;
  return () => {
    // A cache HIT is a CONFIRMED prior supersession for this exact content —
    // returned as-is, never re-scanned. There is no cached-null case (see the
    // memo's own doc comment): an unconfirmed result always re-scans, since
    // corroboration can succeed later even when the text has not changed.
    if (associationRunId !== null && memoHit !== undefined) return memoHit;
    const recovered = recoverRunIdFromTranscript(projectRoot, transcript, sessionUuid);
    if (associationRunId !== null && recovered !== null) {
      markSupersessionResult(sessionUuid, associationRunId, transcript, recovered);
    }
    return recovered;
  };
}

/**
 * Bounded read of a document body (mid-run planned impact + the detail
 * endpoint). Atomic: the size cap is enforced against the SAME descriptor the
 * bytes come from, so a swapped path cannot slip past it (CodeQL
 * js/file-system-race).
 */
export function readBounded(absolute: string): string | null {
  return readBoundedFile(absolute, MAX_DOC_BYTES)?.text ?? null;
}

/**
 * A typed-`unavailable` response for the integrity case (AC5): a pointer that
 * FAILED VALIDATION. It must SHOW as unavailable and must NOT be persisted —
 * never a quiet fall-through to "No run data yet" (external review, openai HIGH).
 *
 * The second case this once served — a pointer naming a worktree git does not
 * register — was removed 2026-07-21: measured, that is the ordinary
 * post-Finalize state of every pointer on disk, not an integrity failure, and
 * treating it as one erased the artifacts of every finished run. Reading is
 * still confined to registered roots by `chooseRoot`, which never used the
 * unregistered path in the first place.
 */
export function integrityResult(
  scenario: MissionContext["scenario"],
  missionTabVisible: boolean,
  rev: string,
  note: string,
  runId: string | null,
): { context: MissionContext; associateRunId: null; associateSource: "iterate_active_pointer" } {
  return {
    context: {
      ...emptyContext(scenario, missionTabVisible, rev),
      runId,
      artifacts: unavailableArtifacts(note),
    },
    associateRunId: null,
    associateSource: "iterate_active_pointer",
  };
}

/** A context with no artifacts — the shape every non-iterate scenario returns. */
export function emptyContext(
  scenario: MissionContext["scenario"],
  missionTabVisible: boolean,
  sourceRev: string,
): MissionContext {
  return {
    schemaVersion: MISSION_CONTEXT_SCHEMA_VERSION,
    scenario,
    missionTabVisible,
    runId: null,
    // Only a resolved iterate with a registered worktree is ever live.
    runLive: false,
    artifacts: [],
    tests: null,
    servesFrId: null,
    sourceRev,
  };
}
