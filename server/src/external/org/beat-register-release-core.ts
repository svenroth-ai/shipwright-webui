/*
 * external/org/beat-register-release-core.ts — the release ACTION itself
 * (iterate-2026-08-18-org-route-beat-register, V4a-2B point 4.4), split out
 * of `beat-register-release.ts` (the Hono route shell) to stay under the
 * 300-line file guideline. The `beat_recovered` audit-append half is split
 * further into `beat-register-release-audit.ts` for the same reason.
 *
 * A JSON-safe MIRROR of leadwright's `lib/beat-register.ts`
 * `recoverRegisterEntry` — not an import, cross-repo — matching its
 * contract exactly (force-close an open entry, append exactly one
 * `beat_recovered` audit line, second call on an already-closed entry is a
 * no-op that appends nothing), including one of its known limitations (see
 * the `MIRRORED LIMITATION` comment below).
 *
 * Trap #2 (task brief): a release clears only the register half of
 * FR-04.41's two-guard gate — `.beat.lock` is untouched, so the lead can
 * still be denied `beat-lock-held` for up to the lock's stale window after
 * this call. The response never claims otherwise (`residualLockWarning`).
 *
 * Lock parameters mirror leadwright's `lib/file-locks.ts` `withLock`
 * DEFAULTS exactly (design decision 5) — this is the same file leadwright's
 * own daemon mutates via that same helper, so genuinely serializing against
 * it means matching its stale/retry contract, not inventing a shorter one
 * the way `decisions-lock.ts` reasonably did for a file with no writer yet
 * at the time.
 */

import * as lockfile from "proper-lockfile";
import { existsSync } from "node:fs";

import { OrgSymlinkEscapeError } from "./decisions-lock.js";
import {
  registerPathFor,
  auditPathFor,
  guardExistingTarget,
  atomicWriteJson,
  readRegisterFileTolerant,
  type LstatFn,
} from "./beat-register.js";
import { recordRecoveryAudit } from "./beat-register-release-audit.js";

export { OrgSymlinkEscapeError };

export const RESIDUAL_LOCK_WARNING =
  ".beat.lock is untouched by this action — the lead may still be denied " +
  "beat-lock-held for up to the lock's stale window (default 30 min) if its " +
  "prior holder crashed without releasing it.";

export type ReleaseOutcome =
  | { ok: true; recovered: true; residualLockWarning: string; beatId: string }
  | { ok: true; recovered: false }
  | { ok: false; reason: "not-found"; detail: string }
  | { ok: false; reason: "fault"; detail: string };

export interface BeatRegisterLockOptions {
  stale: number;
  update: number;
  retries: { retries: number; minTimeout: number; maxTimeout: number; factor: number };
  realpath: true;
}

/** Mirrors leadwright's `lib/file-locks.ts` `withLock` DEFAULTS exactly
 *  (design decision 5) — same stale window, same retry backoff, same
 *  heartbeat interval. Internal-plan-review fix: `update` must be passed
 *  explicitly (leadwright's `withLock` always does) — proper-lockfile's own
 *  default when omitted is `stale/2` (150s here), not leadwright's 1s. */
export const DEFAULT_LOCK_OPTIONS: BeatRegisterLockOptions = {
  stale: 300_000,
  update: 1_000,
  retries: { retries: 10, minTimeout: 50, maxTimeout: 1000, factor: 2 },
  realpath: true,
};

export class BeatRegisterInvalidError extends Error {
  constructor(public readonly path: string) {
    super(`beat-register.json failed structural validation: ${path}`);
  }
}

export interface PerformReleaseDeps {
  leadsRoot: string;
  lockOptions: BeatRegisterLockOptions;
  now: () => Date;
  lstat: LstatFn;
}

/**
 * Pre-lock existence + guard check, split out of `performRelease` (code-
 * review fix, low/readability — keep the lock-acquire/critical-section/
 * release body focused on just that). Returns a short-circuit
 * `ReleaseOutcome` when there is nothing to lock for, or `null` to proceed.
 */
function checkRegisterReachable(
  deps: PerformReleaseDeps,
  registerPath: string,
  sessionId: string,
): ReleaseOutcome | null {
  // Plan-review fix (PR-2): a missing register means nothing was ever
  // recorded for this lead — 404 not-found, no lock acquired, nothing
  // created. Checked BEFORE any lock step.
  if (!existsSync(registerPath)) {
    return { ok: false, reason: "not-found", detail: sessionId };
  }

  // Code-review fix (Stage 2, medium/correctness): `guardExistingTarget`
  // used to let a TOCTOU-deleted register (the file genuinely has a second
  // writer — leadwright's own daemon) propagate as an unhandled exception
  // into a bare 500. A `vanished` result reads exactly like the
  // `existsSync` check just above — nothing to release — so it gets the
  // SAME outcome, not a crash.
  const preGuard = guardExistingTarget(deps.leadsRoot, registerPath, deps.lstat);
  if (!preGuard.ok) {
    if (preGuard.status === 404) {
      return { ok: false, reason: "not-found", detail: sessionId };
    }
    throw new OrgSymlinkEscapeError(registerPath);
  }
  return null;
}

export async function performRelease(
  deps: PerformReleaseDeps,
  leadId: string,
  sessionId: string,
  reason: string,
): Promise<ReleaseOutcome> {
  const registerPath = registerPathFor(deps.leadsRoot, leadId);
  const auditPath = auditPathFor(deps.leadsRoot, leadId);

  const shortCircuit = checkRegisterReachable(deps, registerPath, sessionId);
  if (shortCircuit) {
    return shortCircuit;
  }

  let release: () => Promise<void>;
  try {
    release = await lockfile.lock(registerPath, deps.lockOptions);
  } catch (err) {
    // Doubt-review fix (Stage 3, high/concurrency): a THIRD vanish-window,
    // between `checkRegisterReachable`'s pass and this call — with
    // `realpath: true` (the default here), `proper-lockfile`'s own
    // `lock()` calls `fs.realpath(file)` first and rejects with `ENOENT`
    // if the register disappeared in that gap (the daemon is a real
    // second writer, same threat this file's other two vanish-guards
    // already take seriously). Left unguarded, this fell to the route
    // handler's `throw err` and surfaced as an uncaught 500 instead of the
    // same graceful not-found the other two windows produce. `ELOCKED`
    // (and anything else) still propagates unchanged — the route handler
    // owns that mapping.
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { ok: false, reason: "not-found", detail: sessionId };
    }
    throw err;
  }
  let outcome: ReleaseOutcome;
  try {
    // Post-acquire re-check (mirrors `decisions-lock.ts`'s TOCTOU fix): a
    // co-resident writer could swap the path for a symlink between the
    // pre-lock check and actual acquisition — or, per the same fix as
    // `preGuard` above, delete the file entirely.
    const postGuard = guardExistingTarget(deps.leadsRoot, registerPath, deps.lstat);
    if (!postGuard.ok) {
      if (postGuard.status === 404) {
        outcome = { ok: false, reason: "not-found", detail: sessionId };
        return outcome;
      }
      throw new OrgSymlinkEscapeError(registerPath);
    }

    const read = readRegisterFileTolerant(registerPath);
    if (!read.ok) {
      throw new BeatRegisterInvalidError(registerPath);
    }
    const file = read.file;
    const matches = file.entries.filter((e) => e.sessionId === sessionId);
    // Code-review fix (external cascade, medium/spec): a duplicate
    // sessionId is a FAULT (trap #3 — "never pick one, never show the
    // newest"), and that principle now applies to the write path too, not
    // only the GET /beat-register finding. The prior code did
    // `.find(...)` — the FIRST match — so a fault where entry #1 is
    // already closed and entry #2 is still open made release a silent,
    // permanent no-op on #2: `recovered:false` reads as "nothing to
    // release" even though an open beat sits right behind it, unreachable
    // through this action. Refusing outright (no mutation, no audit
    // write) is the conservative fix — it does NOT invent a new
    // leadwright-side recovery semantic (which of two entries "wins"),
    // it just declines to act on data this route's own sibling route
    // already refuses to summarize as a single state.
    const entry = matches.length === 1 ? matches[0] : undefined;
    if (matches.length > 1) {
      outcome = { ok: false, reason: "fault", detail: sessionId };
    } else if (!entry) {
      outcome = { ok: false, reason: "not-found", detail: sessionId };
    } else if (entry.closedAt !== null) {
      // MIRRORED LIMITATION (plan-review PR-8, disclosed not fixed): no
      // fault-state guard before mutating — identical to leadwright's own
      // `recoverRegisterEntry`, which also does not special-case a
      // duplicate-sessionId register before closing the first match. The
      // duplicate case itself is now caught above; this branch is the
      // ordinary already-closed no-op leadwright's own function also
      // takes.
      outcome = { ok: true, recovered: false };
    } else {
      entry.closedAt = deps.now().toISOString();
      atomicWriteJson(registerPath, file);
      outcome = {
        ok: true,
        recovered: true,
        residualLockWarning: RESIDUAL_LOCK_WARNING,
        beatId: entry.beatId,
      };
    }
  } finally {
    await release();
  }

  // MIRRORED LIMITATION (plan-review PR-9, disclosed not fixed): the audit
  // append runs AFTER the register lock is released, identical ordering to
  // leadwright's own `recoverRegisterEntry` — see
  // `beat-register-release-audit.ts`'s `recordRecoveryAudit` doc comment.
  if (outcome.ok && outcome.recovered) {
    recordRecoveryAudit(deps, leadId, auditPath, sessionId, reason, outcome.beatId);
  }
  return outcome;
}
