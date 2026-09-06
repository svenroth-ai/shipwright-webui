/*
 * routes/org-chart-lead-guard.ts — `requireChartLead`, split out of
 * `org.ts` (which crossed the 300-line convention once the countersign
 * write route landed) so every plain-surface `:leadId`-scoped route —
 * charter PUT, beat-register/release, learnings/audit GET — shares ONE
 * chart-membership check rather than each mount growing its own.
 *
 * Code-review fix (LOW, consistency): the charter PUT route refuses an
 * unregistered leadId (the HIGH external-review fix below); the two GET
 * routes previously only shape-checked the leadId and never checked chart
 * membership, so a stale/decommissioned lead directory left on disk would
 * still serve through the browser-facing proxy. Same posture, every verb.
 *
 * Doubt-review fix (HIGH, security): a shape-invalid RAW leadId must be
 * REJECTED here, never deferred to a downstream core's own check. That
 * deferral was safe for the two GET routes (their cores re-validate the
 * SAME raw string), but not for the PUT charter route: `resolveOrgAllowlistedTarget`
 * derives its OWN, more lenient "leadId" by slicing the path.resolve()-
 * normalized absolute path, and Hono decodes a `%2f` in the route param
 * (but not in path segmentation) — so a raw leadId of `"ghost-lead/"` (from
 * the URL `ghost-lead%2f`) normalizes to the clean, registered
 * `"acme-lead"`-shaped target while `LEAD_ID_RE` (correctly) rejects the RAW
 * string with its trailing slash. Deferring on that rejection let the write
 * proceed with NO chart-membership check at all. `LEAD_ID_RE` matches only
 * `[a-z0-9][a-z0-9-]*` — no `/` or `.` — so a raw string that passes it can
 * never diverge from its own path-normalized form; rejecting here closes
 * the whole class, not just the one PoC. Same 400 `invalid_lead_id` shape
 * the GET routes' cores already used, so their existing 400 contract is
 * unchanged.
 */

import type { Context } from "hono";

import { LEAD_ID_RE } from "../external/org/_helpers.js";
import { orgChartCore, type OrgChartRouteDeps } from "../external/org/org-chart.js";

export type ChartLeadGateResult =
  | { ok: true }
  | { ok: false; response: Response };

export function requireChartLead(
  c: Context,
  leadId: string,
  deps: OrgChartRouteDeps,
): ChartLeadGateResult {
  if (!LEAD_ID_RE.test(leadId)) {
    return { ok: false, response: c.json({ error: "invalid_lead_id" }, 400) };
  }
  const chart = orgChartCore(deps);
  if (chart.status !== 200) {
    return { ok: false, response: c.json(chart.body, chart.status) };
  }
  if (!Object.hasOwn(chart.body.leads, leadId)) {
    return {
      ok: false,
      response: c.json({ error: "unknown_lead", detail: "leadId is not a chart entry" }, 403),
    };
  }
  return { ok: true };
}
