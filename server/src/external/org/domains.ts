/*
 * external/org/domains.ts — GET /api/external/org/domains
 * (iterate-2026-09-07-leadwright-setup-wizard, W14).
 *
 * The ONE shared domain vocabulary: the union of every domain already on
 * the org chart (`org-chart.json leads[].domain`) and every domain already
 * used by a backlog card (webui's task store `domain` field) — closing the
 * defect at its source (both the wizard's domain select and
 * `LeadwrightFields.tsx`'s converted select read from this single route,
 * never two independently-drifting lists).
 *
 * `unclaimedCounts[domain]` mirrors leadwright's own claim predicate
 * (`isClaimableByLead`, lib/lead-task-extension.ts: `state === "draft" &&
 * task.domain === leadDomain && !task.claimToken`) so the count the wizard
 * shows on domain selection means exactly what leadwright will actually
 * hand that lead — never a webui re-derivation of that judgment.
 */
import type { Hono } from "hono";

import { readOrgChartFull, type OrgChartFullReadResult } from "./org-chart-full-read.js";

/** Narrowest shape this route needs out of `SdkSessionsStore` — mirrors the
 *  minimal-injection convention `org-threads-composite.ts`'s
 *  `TaskTitleLookup` established for this same directory. */
export interface TaskDomainLookup {
  list(): Array<{ state?: string; domain?: string; claimToken?: string }>;
}

export interface DomainsRouteDeps {
  leadsRoot: string;
  store: TaskDomainLookup;
  readOrgChartFullFn?: (deps: { leadsRoot: string }) => OrgChartFullReadResult;
}

export type DomainsCoreResult =
  | { status: 200; body: { domains: string[]; unclaimedCounts: Record<string, number> } }
  | { status: 403 | 404 | 500 | 502; body: { error: string; detail?: string } };

export function domainsCore(deps: DomainsRouteDeps): DomainsCoreResult {
  const readOrgChartFullFn = deps.readOrgChartFullFn ?? readOrgChartFull;
  const orgChartResult = readOrgChartFullFn({ leadsRoot: deps.leadsRoot });
  if (orgChartResult.status !== 200) return orgChartResult;

  const domains = new Set<string>();
  for (const lead of Object.values(orgChartResult.body.leads)) {
    if (lead.domain) domains.add(lead.domain);
  }

  const unclaimedCounts: Record<string, number> = {};
  for (const task of deps.store.list()) {
    if (!task.domain) continue;
    domains.add(task.domain);
    if (task.state === "draft" && !task.claimToken) {
      unclaimedCounts[task.domain] = (unclaimedCounts[task.domain] ?? 0) + 1;
    }
  }

  return { status: 200, body: { domains: [...domains].sort(), unclaimedCounts } };
}

export function registerDomainsRoute(app: Hono, deps: DomainsRouteDeps): void {
  app.get("/api/external/org/domains", async (c) => {
    const result = domainsCore(deps);
    return c.json(result.body, result.status);
  });
}
