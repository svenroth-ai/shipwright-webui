/* eslint-disable no-console */
/*
 * The `SHIPWRIGHT_DEBUG_AWAITING_LAUNCH` operator probe for
 * `SessionWatcher.findByUuid`. Split out of `session-watcher.ts` by
 * iterate-2026-07-22-transcript-cursor-single-walk, which needed the lines and
 * found this the least arbitrary thing to move: an env-gated field diagnostic
 * is not "what we look for on disk", and its runbook prose is operator
 * documentation that was living in a hot read path.
 *
 * Iterate v0.8.2 AC-5 (awaiting-launch state lag). The known-good lower bound
 * is ~5–15 s for Claude's first JSONL write plus a 2–5 s server poll cadence
 * (~20 s total). If the field reports >30 s, the most likely cause is an
 * encoded-cwd mismatch — the pty was started under one cwd but `Set-Location`'d
 * before launch, while `task.cwd` records the original. The probe deliberately
 * reports BOTH the directories walked AND the no-match outcome, so the operator
 * can compare what was scanned against the encoded cwd they expected.
 *
 * Returns `null` when disabled so the caller pays one null-check per walk
 * rather than an env read per branch.
 */

export interface AwaitingLaunchProbe {
  readdirFailed(uuid: string, dir: string): void;
  hit(uuid: string, encodedCwd: string, size: number): void;
  miss(uuid: string, subs: string[]): void;
}

export function awaitingLaunchProbe(): AwaitingLaunchProbe | null {
  const flag = process.env.SHIPWRIGHT_DEBUG_AWAITING_LAUNCH;
  if (flag !== "1" && flag !== "true") return null;
  return {
    readdirFailed: (uuid, dir) =>
      console.log(
        `[awaiting-launch] readdir(projectsDir) failed for uuid=${uuid} dir=${dir}`,
      ),
    hit: (uuid, encodedCwd, size) =>
      console.log(
        `[awaiting-launch] HIT uuid=${uuid} encodedCwd=${encodedCwd} size=${size}`,
      ),
    miss: (uuid, subs) =>
      console.log(
        `[awaiting-launch] miss uuid=${uuid} walked=${subs.length} encodedCwds=${subs.slice(0, 8).join(",")}${subs.length > 8 ? ",…" : ""}`,
      ),
  };
}
