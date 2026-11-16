/*
 * core/mission-context/run-id-recovery-ref.ts — corroborate a transcript's Run-ID
 * footer from the default remote ref (split out of run-id-recovery.ts, 300-line rule).
 *
 * Runs on the 1 s Mission poll, so the answer is memoized per session by transcript
 * content for a short TTL (an unchanged transcript is not re-scanned, and a run that
 * merges or is fetched later is still picked up), and any failure reads as "not evidence".
 */

import { findRunIdFooter, hasRunRecord, isNoMarkerMemoized } from "./run-id-recovery.js";
import { findWorkCompletedFromMergedRef, type MergedEventsDeps } from "./merged-events.js";

const TTL_MS = 30_000;
const CAP = 512;
const memo = new Map<string, { fp: string; at: number; result: string | null }>();

/** Test-only: drop the memo between cases. */
export function _clearRefCorroborationMemo(): void {
  memo.clear();
}

/**
 * The transcript's footer id when the merged ref carries its `work_completed` and the
 * working tree does not (the iterate merges via `gh`; the main checkout stays unpulled),
 * else null. `hasRunRecord` reads the working tree only, so without this a finished run
 * in that state was never identified and its Mission tab stayed all-pending.
 */
export async function corroborateRunIdFromMergedRef(
  projectRoot: string,
  transcript: string,
  sessionUuid: string,
  startedMidFile = false,
  deps: MergedEventsDeps = {},
): Promise<string | null> {
  try {
    if (isNoMarkerMemoized(projectRoot, sessionUuid, transcript, startedMidFile)) return null;
    const key = `${projectRoot}::${sessionUuid}`;
    const fp = `${startedMidFile ? 1 : 0}:${transcript.length}:${transcript.slice(-256)}`;
    const now = (deps.now ?? Date.now)();
    const hit = memo.get(key);
    if (hit && hit.fp === fp && now - hit.at < TTL_MS) return hit.result;

    const candidate = findRunIdFooter(transcript, startedMidFile);
    let result: string | null = null;
    if (candidate && !hasRunRecord(projectRoot, candidate)) {
      const fromRef = await findWorkCompletedFromMergedRef(projectRoot, candidate, deps);
      result = fromRef.status === "found" ? candidate : null;
    }
    if (memo.size >= CAP) memo.clear();
    memo.set(key, { fp, at: now, result });
    return result;
  } catch {
    return null; // an unreadable source is never evidence
  }
}
