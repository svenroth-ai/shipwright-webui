/*
 * external/org/beat-register-release.ts — POST
 * /api/external/org/leads/:leadId/beat-register/release
 * (iterate-2026-08-18-org-route-beat-register, V4a-2B point 4.4).
 *
 * Hono route shell only — parses the request and hands off to
 * `handleReleaseRequest` (`beat-register-release-request.ts`), which is
 * ALSO used by the plain browser-facing proxy's release route
 * (`routes/org.ts`, iterate-2026-09-06-org-lead-staleness-register) so the
 * two route shells cannot drift on validation or status-mapping. The
 * release action itself (locking, register mutation, audit append,
 * mirrored leadwright contract) lives in `beat-register-release-core.ts`.
 */

import type { Hono } from "hono";

import { LEAD_ID_RE } from "./_helpers.js";
import type { LstatFn } from "./beat-register.js";
import type { BeatRegisterLockOptions } from "./beat-register-release-core.js";
import { handleReleaseRequest } from "./beat-register-release-request.js";

export {
  performRelease,
  DEFAULT_LOCK_OPTIONS,
  OrgSymlinkEscapeError,
  BeatRegisterInvalidError,
  RESIDUAL_LOCK_WARNING,
} from "./beat-register-release-core.js";
export type { ReleaseOutcome, BeatRegisterLockOptions } from "./beat-register-release-core.js";
export { handleReleaseRequest } from "./beat-register-release-request.js";
export type { ReleaseRequestResult } from "./beat-register-release-request.js";

export interface ReleaseRouteDeps {
  leadsRoot: string;
  lstatSync?: LstatFn;
  lockOptions?: BeatRegisterLockOptions;
  now?: () => Date;
}

export function registerBeatRegisterReleaseRoute(app: Hono, deps: ReleaseRouteDeps): void {
  const { leadsRoot } = deps;

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
    // `handleReleaseRequest` owns the `lstatSync`/`lockOptions`/`now`
    // defaulting itself (external-review fix, GLM) — this shell just
    // passes deps through, never resolving them a second time.
    const result = await handleReleaseRequest(
      { leadsRoot, lstatSync: deps.lstatSync, lockOptions: deps.lockOptions, now: deps.now },
      leadId,
      body,
    );
    return c.json(result.body, result.status);
  });
}
