/*
 * routes/org-lead-setup-wizard.ts — the plain-surface `/api/org/*` mirror
 * of the secret-gated verdict/commit/domains routes
 * (iterate-2026-09-07-leadwright-setup-wizard, W14), split out of `org.ts`
 * (already at the 300-line convention) the same way `org-writes.ts` and
 * `org-leads-composite.ts` were.
 *
 * The wizard runs in the browser — a first-party caller of its own server,
 * same trust level as every other `/api/org/*` route — so it calls these,
 * never the secret-gated `/api/external/org/*` family (that family exists
 * for leadwright's daemon / external tooling). Both surfaces share the
 * SAME pure cores (`domainsCore`, `verdictCore`, `commitCore`) — no
 * behavior duplication, only the auth/host gate differs (dropped here,
 * exactly like the charter PUT route's existing split).
 */
import type { Hono } from "hono";

import { domainsCore, type TaskDomainLookup } from "../external/org/domains.js";
import { verdictCore, type VerdictCoreDeps } from "../external/org/verdict.js";
import { commitCore, type CommitCoreDeps } from "../external/org/commit.js";
import { readOrgChartFull } from "../external/org/org-chart-full-read.js";
import { daemonConfigReadCore } from "../external/org/daemon-config-read.js";
import { runLeadwrightPreflight } from "../core/leadwright-preflight-transport.js";

export interface LeadSetupWizardRouteDeps {
  leadsRoot: string;
  leadwrightCheckoutRoot: string | undefined;
  webuiBaseUrl: string;
  store?: TaskDomainLookup;
}

export function registerLeadSetupWizardRoutes(app: Hono, deps: LeadSetupWizardRouteDeps): void {
  const NO_TASKS: TaskDomainLookup = { list: () => [] };

  app.get("/api/org/domains", async (c) => {
    const result = domainsCore({ leadsRoot: deps.leadsRoot, store: deps.store ?? NO_TASKS });
    return c.json(result.body, result.status);
  });

  const verdictDeps: VerdictCoreDeps = {
    leadsRoot: deps.leadsRoot,
    leadwrightCheckoutRoot: deps.leadwrightCheckoutRoot,
    webuiBaseUrl: deps.webuiBaseUrl,
    readOrgChartFullFn: readOrgChartFull,
    daemonConfigReadFn: daemonConfigReadCore,
    runLeadwrightPreflightFn: runLeadwrightPreflight,
  };
  app.post("/api/org/leads/verdict", async (c) => {
    let requestBody: unknown;
    try {
      requestBody = await c.req.json();
    } catch {
      return c.json({ error: "invalid_request_body" }, 400);
    }
    const result = await verdictCore(verdictDeps, requestBody);
    return c.json(result.body, result.status);
  });

  const commitDeps: CommitCoreDeps = {
    leadsRoot: deps.leadsRoot,
    leadwrightCheckoutRoot: deps.leadwrightCheckoutRoot,
    webuiBaseUrl: deps.webuiBaseUrl,
    readOrgChartFullFn: readOrgChartFull,
    daemonConfigReadFn: daemonConfigReadCore,
  };
  app.post("/api/org/leads/commit", async (c) => {
    let requestBody: unknown;
    try {
      requestBody = await c.req.json();
    } catch {
      return c.json({ error: "invalid_request_body" }, 400);
    }
    const result = await commitCore(commitDeps, requestBody);
    return c.json(result.body, result.status);
  });
}
