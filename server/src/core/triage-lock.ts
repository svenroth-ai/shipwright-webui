/*
 * triage-lock.ts — collision-safe proper-lockfile factory for the
 * Triage routes (ADR-106, iterate-20260515-triage-promote-500).
 *
 * Why this exists:
 *   `<project>/.shipwright/triage.jsonl` is locked by TWO independent,
 *   non-composable primitives:
 *     - shipwright Python producer hooks (compliance / Phase-Quality /
 *       drift) lock via `_FileLock`, which leaves a REGULAR FILE
 *       sidecar at `<file>.lock`;
 *     - the webui locks via `proper-lockfile`, whose DEFAULT lockfile
 *       path is also `<file>.lock` — but proper-lockfile expects a
 *       DIRECTORY there.
 *   When the Python regular-file sidecar is present, `proper-lockfile`
 *   does `mkdir(<file>.lock)` → `EEXIST`, then (a regular file is not a
 *   removable stale lock-dir) exhausts its retries and throws
 *   `ELOCKED`. Every webui triage write 500s. The Python sidecar
 *   persists on disk, so the collision is permanent — not a race.
 *
 * Fix: route the webui's lockfile to `<file>.weblock` so the two
 *   primitives occupy disjoint paths. They never mutually-excluded
 *   each other anyway (the "don't compose" Known Limitation from
 *   ADR-101 + `triage-write.ts`); write safety rests on append-mode
 *   line-atomicity + last-status-wins resolution, unchanged.
 *
 * This factory is the single, tested home of the `.weblock` decision —
 * `index.ts` wires its result as `createTriageRoutes` `deps.lock`. The
 * triage routes are the only Node-side writer of `triage.jsonl`
 * (`triage-write.ts:appendStatusEvent`), so no other Node lock site
 * needs the same treatment.
 */

import * as lockfile from "proper-lockfile";

export type TriageLockRelease = () => Promise<void>;

/**
 * Build the `deps.lock` helper for the Triage routes. Locking path `p`
 * coordinates via a `<p>.weblock` directory — never the `<p>.lock`
 * path the Python `_FileLock` sidecar occupies.
 *
 * @param retries proper-lockfile retry budget. Default 3 (production —
 *   rides out transient webui-vs-webui contention from another tab).
 *   Tests pass 0 for deterministic fast-fail on contention.
 */
export function createTriageLock(
  retries = 3,
): (p: string) => Promise<TriageLockRelease> {
  return (p: string) =>
    lockfile.lock(p, { retries, lockfilePath: `${p}.weblock` });
}
