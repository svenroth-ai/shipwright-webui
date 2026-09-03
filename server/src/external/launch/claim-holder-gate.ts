/*
 * external/launch/claim-holder-gate.ts — FR-04.22 / V5 (leadwright
 * spec/lead-model-spec.md §5.2 + §10.9, PO decision 2026-08-16).
 *
 * The launch route refuses everyone while `claimToken` is set — EXCEPT the
 * claim holder, who must be able to (re)launch (AC FR-04.22). `task` passed
 * in here MUST already be the freshly-disk-read row (see
 * SdkSessionsStore.refreshRowFromDisk in ../../core/sdk-sessions-store.ts) —
 * this module makes no disk access itself and trusts the caller's freshness.
 *
 * §10.9 decided variant (a) plus a time window: the exception accepts the
 * caller presenting the CURRENT claimToken, and additionally requires
 * `claimedAt` to be no older than CLAIM_LAUNCH_WINDOW_MS. Explicitly
 * rejected: making the token single-use (valid only while `launchedAt` is
 * unset) — that breaks AC FR-04.22's "a restart by the holder succeeds".
 *
 * Named residual risk (§8, §10.9): both sides run as the same local user
 * with sdk-sessions.json readable, so this defends against a MISTAKE (a
 * stale browser tab racing a daemon claim), not a local attacker — a
 * process on the same machine under the same user can read the token
 * directly. The window only shrinks that exposure; it does not close it.
 */

import type { ExternalTask } from "../../core/sdk-sessions-store.js";

/**
 * How long a claim stays launch-eligible after `claimedAt`. §10.9 left the
 * VALUE unfixed ("a named limit"), justified only against one criterion: a
 * holder who restarts LATE must still succeed, never be locked out (AC
 * FR-04.22) — the fix for a stale token is re-claiming, not an indefinite
 * grant. 24h is generous enough to survive a sleeping laptop, a slow beat,
 * or an overnight gap between claim and restart, while still bounding how
 * long an abandoned claim stays replayable.
 */
export const CLAIM_LAUNCH_WINDOW_MS = 24 * 60 * 60 * 1000;

/**
 * Doubt-review finding (iterate-2026-09-03-claim-holder-launch): `withinWindow`
 * originally only bounded the claim's age from ABOVE, so a well-formed but
 * FUTURE-dated `claimedAt` (clock skew between the webui host and the daemon
 * host, or a daemon bug) made `Date.now() - claimedAtMs` negative — always
 * `<= CLAIM_LAUNCH_WINDOW_MS`, reading as "very fresh" instead of being
 * rejected. `sdk-sessions-validate.ts` does no date-sanity check on
 * `claimedAt`, so this module is the only place that can catch it. A small
 * tolerance (rather than rejecting any future timestamp outright) survives
 * ordinary clock drift between two processes' wall clocks without reopening
 * the gap: anything beyond it is refused as not-within-window, same as an
 * expired claim.
 */
export const CLAIM_CLOCK_SKEW_TOLERANCE_MS = 5 * 60 * 1000;

export type ClaimGateResult =
  | { allowed: true }
  | { allowed: false; error: Record<string, unknown> };

/**
 * Decide whether a launch request may proceed against a (possibly) claimed
 * task. Returns `{ allowed: true }` when there is no active claim, or when
 * `bodyClaimToken` matches the task's current `claimToken` AND the claim is
 * within the launch window. Otherwise refuses with the `task_claimed`
 * envelope — `claimExpired: true` distinguishes "right token, too old" from
 * a foreign/absent token (trap: an expired claim must read differently from
 * someone else's).
 */
export function checkClaimHolderGate(
  task: ExternalTask,
  bodyClaimToken: string | undefined,
): ClaimGateResult {
  if (typeof task.claimToken !== "string" || task.claimToken.length === 0) {
    return { allowed: true };
  }

  const tokenMatches =
    bodyClaimToken !== undefined && bodyClaimToken === task.claimToken;
  const claimedAtMs = task.claimedAt ? Date.parse(task.claimedAt) : NaN;
  const age = Date.now() - claimedAtMs;
  const withinWindow =
    Number.isFinite(claimedAtMs) &&
    age >= -CLAIM_CLOCK_SKEW_TOLERANCE_MS &&
    age <= CLAIM_LAUNCH_WINDOW_MS;

  if (tokenMatches && withinWindow) {
    return { allowed: true };
  }

  console.warn(
    JSON.stringify({
      level: "warn",
      message: "task_claimed: launch refused while claimToken is set",
      taskId: task.taskId,
      claimedBy: task.claimedBy,
      claimedAt: task.claimedAt,
      claimPid: task.claimPid,
      reason: tokenMatches ? "claim_expired" : "foreign_claim",
    }),
  );

  const error: Record<string, unknown> = {
    error: "task_claimed",
    claimedBy: task.claimedBy,
    claimedAt: task.claimedAt,
  };
  if (tokenMatches) error.claimExpired = true;
  return { allowed: false, error };
}
