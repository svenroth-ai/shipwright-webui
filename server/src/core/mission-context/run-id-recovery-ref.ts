/*
 * core/mission-context/run-id-recovery-ref.ts — corroborate a transcript's Run-ID
 * footer from the default remote ref (split out of run-id-recovery.ts, 300-line rule).
 */

import { findRunIdFooter, hasRunRecord, isNoMarkerMemoized } from "./run-id-recovery.js";
import { findWorkCompletedFromMergedRef, type MergedEventsDeps } from "./merged-events.js";

/**
 * Async corroboration for a run whose record is on the default remote ref but NOT
 * in the working tree yet (the iterate merges via `gh`; the user's main checkout
 * stays at its old HEAD). `hasRunRecord` reads the working tree only, so such a
 * finished run was never identified and its Mission tab stayed all-pending.
 *
 * Returns the transcript's footer id when the merged ref carries its
 * `work_completed`, else null. Skipped when the working tree already corroborates
 * (the sync path handles it) or the memoized "no marker" fact applies.
 */
export async function corroborateRunIdFromMergedRef(
  projectRoot: string,
  transcript: string,
  sessionUuid: string,
  startedMidFile = false,
  deps: MergedEventsDeps = {},
): Promise<string | null> {
  if (isNoMarkerMemoized(projectRoot, sessionUuid, transcript, startedMidFile)) return null;
  const candidate = findRunIdFooter(transcript, startedMidFile);
  if (!candidate || hasRunRecord(projectRoot, candidate)) return null;
  const fromRef = await findWorkCompletedFromMergedRef(projectRoot, candidate, deps);
  return fromRef.status === "found" ? candidate : null;
}
