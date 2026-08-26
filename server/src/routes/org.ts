/*
 * routes/org.ts — the plain-surface `/api/org/*` proxy (iterate spec Design
 * Notes, "Server-side proxy route"). Browser-facing mirror of
 * `external/org/routes.ts`'s secret-gated family, sharing its extracted
 * pure cores directly (no HTTP, no `registerXRoute` call — see "No
 * route-mount collision").
 *
 * Only the shared-secret gate is dropped (the browser is a first-party
 * caller of its own server); the host allowlist (`isAllowedOrgRouteHost`,
 * FR-04.38 Auflage 1, a PO-decided control independent of the secret) is
 * retained here as its own middleware, unchanged.
 *
 * Endpoints:
 *   GET /api/org/org-chart              — wraps `orgChartCore` verbatim.
 *   GET /api/org/leads                  — composite roster (see
 *                                          `org-leads-composite.ts`).
 *   GET /api/org/file?path=<relpath>    — read-only, the SAME six-kind
 *     allowlist the gated route's GET uses (`resolveOrgAllowlistedTarget`);
 *     unrestricted by kind, unlike the PUT below — a read carries none of
 *     the unlocked-write risk AC-10 guards against. Backs the
 *     shared-documents block (org-chart.json's sibling docs: conventions.md,
 *     principal.md, decision_log.md) and the charter.md fresh-load-before-
 *     edit round trip (`orgMarkdownFileApi.ts`).
 *   PUT /api/org/leads/:leadId/charter  — the ONLY browser write this
 *     iterate; refuses (403) anything that would resolve to a non-`charter`
 *     kind (AC-10) — in particular `decision_log.md` /
 *     `decisions-proposed.md`, which stay lock-guarded on the existing
 *     gated route only.
 */

import { Hono, type Context } from "hono";

import { isAllowedOrgRouteHost, resolveOrgAllowlistedTarget, LEAD_ID_RE } from "../external/org/_helpers.js";
import { orgChartCore } from "../external/org/org-chart.js";
import { readAllLeadOrgInfo, type LeadOrgInfoResult } from "../external/org/org-chart-lookup.js";
import { orgFileReadCore, type OrgFileReadDeps } from "../external/org/file-read.js";
import { orgFileWriteCore, type OrgFileWriteDeps } from "../external/org/file-write.js";
import { buildLeadRosterEntry, type LeadRosterBuildDeps } from "./org-leads-composite.js";
import { leadLearningsReadCore, type LeadDocReadDeps } from "../external/org/lead-doc-read.js";
import { auditLogCore, type AuditLogDeps } from "../external/org/audit-log.js";
import type { LeadsRosterResponse } from "../types/org.js";

export interface OrgApiRouterDeps {
  leadsRoot: string;
  /** The application's resolved bind host — passed through, never re-derived. */
  honoHost: string;
  /** Widest shared shape — file-write's core additionally needs `isFile()`. */
  lstatSync?: OrgFileWriteDeps["lstatSync"];
  openSync?: OrgFileReadDeps["openSync"];
  withDecisionsLock?: OrgFileWriteDeps["withDecisionsLock"];
  now?: () => Date;
}

export function createOrgApiRouter(deps: OrgApiRouterDeps): Hono {
  const app = new Hono();
  const { leadsRoot, honoHost } = deps;

  app.use("/api/org/*", async (c, next) => {
    if (!isAllowedOrgRouteHost(honoHost)) {
      return c.json({ error: "host_not_allowed" }, 403);
    }
    await next();
  });

  app.get("/api/org/org-chart", async (c) => {
    const result = orgChartCore({ leadsRoot, lstatSync: deps.lstatSync });
    return c.json(result.body, result.status);
  });

  app.get("/api/org/leads", async (c) => {
    const chart = orgChartCore({ leadsRoot, lstatSync: deps.lstatSync });
    if (chart.status !== 200) {
      return c.json(chart.body, chart.status);
    }
    const buildDeps: LeadRosterBuildDeps = {
      leadsRoot,
      lstatSync: deps.lstatSync,
      openSync: deps.openSync,
      now: deps.now,
    };
    // Code-review fix (doc accuracy): this handler still parses
    // org-chart.json TWICE per request — once above via `orgChartCore` for
    // the roster body (full-validates every lead, all-or-nothing), once
    // here via `readAllLeadOrgInfo` for the per-lead cron/reports_to lookup
    // (tolerant of a broken lead elsewhere in the file — see
    // org-chart-lookup.ts's header for why that can't be the same parse).
    // What the N+1 fix actually buys (iterate spec Design Notes, "One
    // composite endpoint, not N+1") is AT MOST TWO parses per request,
    // never one per lead — `forLead` below is an in-memory lookup over the
    // one parse done here, not a re-read.
    const orgInfoResult = readAllLeadOrgInfo(leadsRoot);
    const orgInfoFor = (leadId: string): LeadOrgInfoResult =>
      orgInfoResult.ok ? orgInfoResult.forLead(leadId) : orgInfoResult;
    const leads = Object.entries(chart.body.leads).map(([leadId, lead]) =>
      buildLeadRosterEntry(buildDeps, leadId, lead, orgInfoFor(leadId)),
    );
    const body: LeadsRosterResponse = { leads };
    return c.json(body, 200);
  });

  app.get("/api/org/file", async (c) => {
    const result = orgFileReadCore(
      { leadsRoot, openSync: deps.openSync },
      c.req.query("path"),
    );
    if (result.kind === "json") {
      return c.json(result.body, result.status);
    }
    for (const [key, value] of Object.entries(result.headers)) {
      c.header(key, value);
    }
    return c.body(new Uint8Array(result.body), result.status);
  });

  // Code-review fix (LOW, consistency): the charter PUT route below refuses
  // an unregistered leadId (the HIGH external-review fix); these two GET
  // routes previously only shape-checked the leadId and never checked chart
  // membership, so a stale/decommissioned lead directory left on disk would
  // still serve through the browser-facing proxy. Same posture, both verbs.
  //
  // Doubt-review fix (HIGH, security): a shape-invalid RAW leadId must be
  // REJECTED here, never deferred to a downstream core's own check. That
  // deferral was safe for the two GET routes (their cores re-validate the
  // SAME raw string), but not for the PUT charter route below:
  // `resolveOrgAllowlistedTarget` derives its OWN, more lenient "leadId" by
  // slicing the path.resolve()-normalized absolute path, and Hono decodes a
  // `%2f` in the route param (but not in path segmentation) — so a raw
  // leadId of `"ghost-lead/"` (from the URL `ghost-lead%2f`) normalizes to
  // the clean, registered `"acme-lead"`-shaped target while `LEAD_ID_RE`
  // (correctly) rejects the RAW string with its trailing slash. Deferring
  // on that rejection let the write proceed with NO chart-membership check
  // at all. `LEAD_ID_RE` matches only `[a-z0-9][a-z0-9-]*` — no `/` or `.`
  // — so a raw string that passes it can never diverge from its own
  // path-normalized form; rejecting here closes the whole class, not just
  // the one PoC. Same 400 `invalid_lead_id` shape the GET routes' cores
  // already used, so their existing 400 contract is unchanged.
  function requireChartLead(c: Context, leadId: string) {
    if (!LEAD_ID_RE.test(leadId)) {
      return { ok: false as const, response: c.json({ error: "invalid_lead_id" }, 400) };
    }
    const chart = orgChartCore({ leadsRoot, lstatSync: deps.lstatSync });
    if (chart.status !== 200) {
      return { ok: false as const, response: c.json(chart.body, chart.status) };
    }
    if (!Object.hasOwn(chart.body.leads, leadId)) {
      return {
        ok: false as const,
        response: c.json({ error: "unknown_lead", detail: "leadId is not a chart entry" }, 403),
      };
    }
    return { ok: true as const };
  }

  app.get("/api/org/leads/:leadId/learnings", async (c) => {
    const leadId = c.req.param("leadId");
    const gate = requireChartLead(c, leadId);
    if (!gate.ok) return gate.response;
    const leadDeps: LeadDocReadDeps = { leadsRoot, openSync: deps.openSync };
    const result = leadLearningsReadCore(leadDeps, leadId);
    if (result.kind === "json") {
      return c.json(result.body, result.status);
    }
    for (const [key, value] of Object.entries(result.headers)) {
      c.header(key, value);
    }
    return c.body(new Uint8Array(result.body), result.status);
  });

  app.get("/api/org/leads/:leadId/audit", async (c) => {
    const leadId = c.req.param("leadId");
    const gate = requireChartLead(c, leadId);
    if (!gate.ok) return gate.response;
    const auditDeps: AuditLogDeps = { leadsRoot, openSync: deps.openSync };
    const beforeRaw = c.req.query("before");
    const limitRaw = c.req.query("limit");
    const result = auditLogCore(auditDeps, {
      leadId,
      before: beforeRaw !== undefined ? Number(beforeRaw) : undefined,
      limit: limitRaw !== undefined ? Number(limitRaw) : undefined,
    });
    return c.json(result.body, result.status);
  });

  app.put("/api/org/leads/:leadId/charter", async (c) => {
    const leadId = c.req.param("leadId");
    const relpath = `${leadId}/charter.md`;

    // AC-10: only a `charter` kind may pass through this browser-facing
    // proxy — every other allowlisted kind (decision_log,
    // decisions_proposed, conventions, principal, agents) is refused here,
    // before ever reaching the write core.
    const target = resolveOrgAllowlistedTarget(leadsRoot, relpath);
    if (!target.ok) {
      const status = target.reason === "not_allowlisted" ? 403 : 400;
      const err = target.reason === "traversal" ? "path_traversal" : target.reason;
      return c.json({ error: err, detail: target.reason }, status);
    }
    if (target.kind !== "charter") {
      return c.json(
        { error: "not_allowlisted", detail: "only charter.md is writable here" },
        403,
      );
    }

    // External-review fix (HIGH, security): the checks above only prove
    // `leadId` is kebab-case-shaped and that its `charter.md` sits inside
    // `leadsRoot` — they never confirm `leadId` is an actual chart entry.
    // Any syntactically valid, never-registered lead id could otherwise
    // have a charter.md written (and later read back through the same
    // allowlist) with no corresponding org-chart.json entry. Require the
    // lead to be a real roster member before the write proceeds.
    const gate = requireChartLead(c, leadId);
    if (!gate.ok) return gate.response;

    const writeDeps: OrgFileWriteDeps = {
      leadsRoot,
      lstatSync: deps.lstatSync,
      withDecisionsLock: deps.withDecisionsLock,
    };
    const result = await orgFileWriteCore(writeDeps, {
      relpath,
      contentLengthHeader: c.req.header("content-length"),
      body: await c.req.text(),
      ifMatch: c.req.header("if-match"),
    });
    return c.json(result.body, result.status as 200 | 400 | 403 | 404 | 409 | 413 | 500);
  });

  return app;
}
