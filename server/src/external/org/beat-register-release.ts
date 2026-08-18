/*
 * external/org/beat-register-release.ts — POST
 * /api/external/org/leads/:leadId/beat-register/release
 * (iterate-2026-08-18-org-route-beat-register, V4a-2B point 4.4).
 *
 * Hono route shell only — request validation + error-to-status mapping.
 * The release action itself (locking, register mutation, audit append,
 * mirrored leadwright contract) lives in `beat-register-release-core.ts`,
 * split out to stay under the 300-line file guideline.
 */

import type { Hono } from "hono";
import { lstatSync } from "node:fs";

import { LEAD_ID_RE } from "./_helpers.js";
import type { LstatFn } from "./beat-register.js";
import {
  performRelease,
  DEFAULT_LOCK_OPTIONS,
  OrgSymlinkEscapeError,
  BeatRegisterInvalidError,
  type ReleaseOutcome,
  type BeatRegisterLockOptions,
} from "./beat-register-release-core.js";

export {
  performRelease,
  DEFAULT_LOCK_OPTIONS,
  OrgSymlinkEscapeError,
  BeatRegisterInvalidError,
  RESIDUAL_LOCK_WARNING,
} from "./beat-register-release-core.js";
export type { ReleaseOutcome, BeatRegisterLockOptions } from "./beat-register-release-core.js";

const RELEASE_REASON_MAX_LENGTH = 500;
// Doubt-review fix (Stage 3, medium/correctness): no `/i` flag. Entry
// matching in `beat-register-release-core.ts` is an exact `===` string
// comparison, never normalized — leadwright's own writer always produces
// `crypto.randomUUID()`, which is defined to be lowercase, so the register
// can never legitimately hold an uppercase-cased entry. Accepting a
// differently-cased-but-otherwise-valid sessionId here let it pass
// validation and then silently miss its real (lowercase) register entry,
// returning 404 not-found for an entry that genuinely exists.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export interface ReleaseRouteDeps {
  leadsRoot: string;
  lstatSync?: LstatFn;
  lockOptions?: BeatRegisterLockOptions;
  now?: () => Date;
}

export function registerBeatRegisterReleaseRoute(app: Hono, deps: ReleaseRouteDeps): void {
  const leadsRoot = deps.leadsRoot;
  const lstat = deps.lstatSync ?? ((p: string) => lstatSync(p));
  const lockOptions = deps.lockOptions ?? DEFAULT_LOCK_OPTIONS;
  const now = deps.now ?? (() => new Date());

  app.post("/api/external/org/leads/:leadId/beat-register/release", async (c) => {
    const leadId = c.req.param("leadId");
    if (!LEAD_ID_RE.test(leadId)) {
      return c.json({ error: "invalid_lead_id", leadId }, 400);
    }

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }
    const { sessionId, reason } = (body ?? {}) as { sessionId?: unknown; reason?: unknown };
    if (typeof sessionId !== "string" || !UUID_RE.test(sessionId)) {
      return c.json({ error: "sessionId_invalid" }, 400);
    }
    if (
      typeof reason !== "string" ||
      reason.length === 0 ||
      reason.length > RELEASE_REASON_MAX_LENGTH
    ) {
      return c.json(
        { error: "reason_invalid", detail: `must be 1-${RELEASE_REASON_MAX_LENGTH} chars` },
        400,
      );
    }

    let outcome: ReleaseOutcome;
    try {
      outcome = await performRelease(
        { leadsRoot, lockOptions, now, lstat },
        leadId,
        sessionId,
        reason,
      );
    } catch (err) {
      if (err instanceof OrgSymlinkEscapeError) {
        return c.json({ error: "symlink_forbidden", path: err.path }, 403);
      }
      if (err instanceof BeatRegisterInvalidError) {
        return c.json({ error: "beat_register_invalid", leadId }, 502);
      }
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ELOCKED") {
        return c.json({ error: "beat_register_locked", leadId }, 409);
      }
      throw err;
    }

    if (!outcome.ok) {
      // "fault" (duplicate sessionId — trap #3, never resolved by picking
      // one) is a structural data conflict, not "nothing here": 409, not
      // 404.
      const status = outcome.reason === "fault" ? 409 : 404;
      return c.json({ ok: false, reason: outcome.reason, detail: outcome.detail }, status);
    }
    if (!outcome.recovered) {
      return c.json({ ok: true, recovered: false }, 200);
    }
    return c.json(
      { ok: true, recovered: true, residualLockWarning: outcome.residualLockWarning },
      200,
    );
  });
}
