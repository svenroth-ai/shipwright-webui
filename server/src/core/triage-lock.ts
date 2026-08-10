/*
 * triage-lock.ts — collision-safe proper-lockfile factory for legacy
 * Node-owned stores (ADR-106, iterate-20260515-triage-promote-500).
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
 * Fix: route a Node store's lockfile to `<file>.weblock` so the two
 *   primitives occupy disjoint paths. Triage transition safety now rests on
 *   the Python CLI; this helper remains for other Node-owned stores.
 *
 * This factory is the single, tested home of the `.weblock` decision —
 * Current users include campaign and dismissed-campaign stores. Triage routes
 * do not use this helper: they execute the Python CLI for every transition.
 */

import * as lockfile from "proper-lockfile";

export type TriageLockRelease = () => Promise<void>;

/**
 * Build a collision-safe lock helper. Locking path `p`
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
