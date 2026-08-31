/*
 * external/mission-context/association-write.ts — the ONE guarded
 * association write (CONTRACT §5), split out of routes.ts (2026-08-31,
 * iterate-2026-08-31-mission-feed-gaps) to stay under the 300-line file-size
 * limit. Pure continuation of the GET handler's persistence step: routes.ts
 * resolves the context and hands the decision here.
 *
 * Idempotent for a first association: the store no-ops when one already
 * exists, so repeated polls perform exactly zero writes after the first.
 * Never a per-GET side-effect.
 */

import {
  revertMissionContext,
  revertSupersession,
  setMissionContextOnce,
  supersedeMissionContext,
} from "../../core/mission-context/association.js";
import type { MissionContextAssociation } from "../../core/mission-context/types.js";
import type { ExternalTask, SdkSessionsStore } from "../../core/sdk-sessions-store.js";

/**
 * Persist a resolved association — either the FIRST one for a task, or a
 * confirmed supersession of a stale one. Caller must have already checked
 * `associateRunId` is non-null.
 *
 * `associationAtResolve` is the snapshot `resolveMissionContext` actually
 * decided against (captured by the caller BEFORE its slow async work, e.g.
 * `routes.ts`) — not re-read here. Both write paths compare against it, not
 * a fresh `task.missionContext`: by the time this async function runs, a
 * concurrent poll may already have written a NEWER association, and a fresh
 * read here would silently adopt that as the "expected" value, letting THIS
 * poll's now-stale decision overwrite it with no failure involved (a plain
 * lost-update race, doubt-reviewer HIGH, iterate-2026-08-31-mission-feed-gaps
 * — ELOCKED rollback cannot catch it because nothing fails).
 */
export async function persistMissionAssociation(
  store: SdkSessionsStore,
  task: ExternalTask,
  associationAtResolve: MissionContextAssociation | null,
  associateRunId: string,
  associateSource: MissionContextAssociation["source"],
  now: () => Date,
  wideWindows: Map<string, { seen: string; scanned: string }>,
): Promise<void> {
  if (!associationAtResolve) {
    const association: MissionContextAssociation = {
      kind: "iterate",
      runId: associateRunId,
      observedAt: now().toISOString(),
      source: associateSource,
    };
    if (setMissionContextOnce(store, task.taskId, association)) {
      try {
        await store.persist();
      } catch {
        // A lock contention (ELOCKED) or I/O fault must not fail the READ —
        // but the in-memory field MUST be rolled back, or every later poll
        // would see it set, skip the write, and the association would never
        // reach disk (external code review, openai HIGH).
        revertMissionContext(store, task.taskId, association);
        // …and the reach-back must be rolled back WITH it. The marker was
        // recorded before the resolve; leaving it would make every later poll
        // read only the ordinary tail while the task is unidentified again —
        // permanently unreachable for a footer beyond it, which is the very
        // data loss the rollback above exists to prevent, re-entered through
        // the read side (internal code review, MEDIUM).
        wideWindows.delete(task.taskId);
      }
    }
    return;
  }

  if (associateSource === "transcript_run_id" && associateRunId !== associationAtResolve.runId) {
    // THE evidence-gated supersession write (association.ts,
    // iterate-2026-08-31-mission-feed-gaps, external code review, openai
    // HIGH). scenario.ts rule 2b has already required a corroborated
    // footer naming a PROVABLY newer run before offering `associateRunId`
    // here — this is the write that makes that correction durable instead
    // of re-proving itself from the transcript on every poll forever.
    const previous = associationAtResolve;
    const association: MissionContextAssociation = {
      kind: "iterate",
      runId: associateRunId,
      observedAt: now().toISOString(),
      source: associateSource,
    };
    // Compare-and-set against `previous` (association.ts, external code
    // review openai MEDIUM + doubt-reviewer HIGH): the store's CURRENT value
    // must still equal what this decision was based on, or the write is
    // skipped and the next poll resolves fresh against whatever is now
    // current — never a blind overwrite of a value a faster concurrent poll
    // already corrected further.
    if (supersedeMissionContext(store, task.taskId, association, previous)) {
      try {
        await store.persist();
      } catch {
        // Same ELOCKED/I-O-fault posture as the first-association rollback
        // above — but there is a PREVIOUS association to restore here, not
        // an empty field to revert to.
        revertSupersession(store, task.taskId, association, previous);
      }
    }
  }
}
