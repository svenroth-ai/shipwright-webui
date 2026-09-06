/*
 * routes/org-writes.ts — the plain surface's two `:leadId`-independent-vs-
 * dependent "action" writes (as opposed to the charter PUT's document
 * write, which stays in `org.ts`), split out once the countersign route
 * pushed `org.ts` over the 300-line convention. Both mirror a secret-gated
 * twin's contract exactly via a shared core — same validation, same status
 * mapping, same lock/mutate action — never a second implementation:
 *
 *   POST /api/org/leads/:leadId/beat-register/release — the SECOND browser
 *     write (iterate-2026-09-06-org-lead-staleness-register, FR-04.41), via
 *     `handleReleaseRequest` (`beat-register-release-request.ts`). Gated by
 *     `requireChartLead` BEFORE body parsing (finding #11) — an
 *     unregistered leadId never reaches the register at all.
 *   POST /api/org/decisions/countersign — the THIRD browser write
 *     (iterate-2026-09-06-decisions-proposed-countersign), via
 *     `handleCountersignRequest` (`countersign-request.ts`). Not
 *     lead-scoped (no `:leadId` path segment — the request body's own
 *     `{timestamp, leadId}` pair identifies the proposal), so it carries no
 *     `requireChartLead` gate; the FR-04.28 lock + allowlist-resolved paths
 *     are the only guards, same as the gated route.
 */

import type { Hono } from "hono";

import type { OrgFileWriteDeps } from "../external/org/file-write.js";
import type { BeatRegisterLockOptions } from "../external/org/beat-register-release-core.js";
import { handleReleaseRequest } from "../external/org/beat-register-release-request.js";
import { handleCountersignRequest } from "../external/org/countersign-request.js";
import { requireChartLead } from "./org-chart-lead-guard.js";

export interface OrgWriteActionsDeps {
  leadsRoot: string;
  lstatSync?: OrgFileWriteDeps["lstatSync"];
  withDecisionsLock?: OrgFileWriteDeps["withDecisionsLock"];
  now?: () => Date;
  /** Beat-register release lock tuning — defaults to the same
   *  `DEFAULT_LOCK_OPTIONS` the secret-gated release route uses. */
  releaseLockOptions?: BeatRegisterLockOptions;
}

export function registerOrgWriteActions(app: Hono, deps: OrgWriteActionsDeps): void {
  const { leadsRoot } = deps;

  app.post("/api/org/leads/:leadId/beat-register/release", async (c) => {
    const leadId = c.req.param("leadId");
    const gate = requireChartLead(c, leadId, { leadsRoot, lstatSync: deps.lstatSync });
    if (!gate.ok) return gate.response;

    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }

    // `handleReleaseRequest` owns the `lstatSync`/`lockOptions`/`now`
    // defaulting itself (external-review fix, GLM: two independent
    // defaulting sites for the same deps is the drift risk finding #5
    // already extracted this function to prevent) — pass deps through
    // unresolved.
    const result = await handleReleaseRequest(
      { leadsRoot, lstatSync: deps.lstatSync, lockOptions: deps.releaseLockOptions, now: deps.now },
      leadId,
      body,
    );
    return c.json(result.body, result.status);
  });

  app.post("/api/org/decisions/countersign", async (c) => {
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: "invalid_json" }, 400);
    }

    // `handleCountersignRequest` owns the `lstatSync`/`withDecisionsLock`
    // defaulting itself, same rationale as `handleReleaseRequest` above.
    const result = await handleCountersignRequest(
      { leadsRoot, lstatSync: deps.lstatSync, withDecisionsLock: deps.withDecisionsLock },
      body,
    );
    return c.json(result.body, result.status);
  });
}
