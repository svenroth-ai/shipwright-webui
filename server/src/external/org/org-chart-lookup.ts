/*
 * external/org/org-chart-lookup.ts — narrow per-lead reader over
 * `org-chart.json` (iterate-2026-08-18-org-route-beat-register, design
 * decision 4).
 *
 * Deliberately NOT `org-chart.ts`'s `parseOrgChart`: that function requires
 * EVERY lead in the file to pass full structural validation (its own
 * header: "a malformed file produces an error, never a half structure") —
 * exactly right for the named `GET /org-chart` endpoint, wrong here. A
 * staleness lookup for lead A must not fail because lead B's entry is
 * malformed; this reader looks up ONLY the two fields (`triggers.cron`,
 * `reports_to`) for the one requested `leadId`, tolerant of everything
 * else in the file being broken.
 *
 * Plan-review fix (PR-6, deepseek): a symlinked/escaping `org-chart.json`
 * is reported as its OWN reason (`org_chart_symlink`), distinct from
 * "missing" or "malformed JSON" — `org-chart.ts`'s own named endpoint 403s
 * on this condition; this reader can't 403 (it isn't a route), but callers
 * must be able to tell the two apart rather than collapsing both into a
 * generic "unknown".
 */

import { readFileSync, lstatSync } from "node:fs";
import path from "node:path";

import { realPathGuard } from "../../core/path-guard.js";

export type LeadOrgInfoReason =
  | "org_chart_missing"
  | "org_chart_symlink"
  | "org_chart_invalid"
  | "lead_not_found";

export type LeadOrgInfoResult =
  | { ok: true; cron: string; reportsTo: string | null }
  | { ok: false; reason: LeadOrgInfoReason };

type LstatFn = (p: string) => { isSymbolicLink(): boolean };

export function readLeadOrgInfo(
  leadsRoot: string,
  leadId: string,
  lstatSyncFn: LstatFn = lstatSync,
): LeadOrgInfoResult {
  const target = path.join(leadsRoot, "org-chart.json");

  let lst;
  try {
    lst = lstatSyncFn(target);
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { ok: false, reason: "org_chart_missing" };
    }
    return { ok: false, reason: "org_chart_invalid" };
  }
  if (lst.isSymbolicLink()) {
    return { ok: false, reason: "org_chart_symlink" };
  }

  const containment = realPathGuard(leadsRoot, target);
  if (!containment.ok) {
    return { ok: false, reason: "org_chart_symlink" };
  }

  let raw: string;
  try {
    raw = readFileSync(target, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException)?.code === "ENOENT") {
      return { ok: false, reason: "org_chart_missing" };
    }
    return { ok: false, reason: "org_chart_invalid" };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: "org_chart_invalid" };
  }
  if (typeof parsed !== "object" || parsed === null) {
    return { ok: false, reason: "org_chart_invalid" };
  }

  const leadsField = (parsed as Record<string, unknown>).leads;
  if (typeof leadsField !== "object" || leadsField === null || Array.isArray(leadsField)) {
    return { ok: false, reason: "org_chart_invalid" };
  }

  const lead = (leadsField as Record<string, unknown>)[leadId];
  if (typeof lead !== "object" || lead === null) {
    return { ok: false, reason: "lead_not_found" };
  }
  const leadRecord = lead as Record<string, unknown>;

  const triggers = leadRecord.triggers;
  if (typeof triggers !== "object" || triggers === null) {
    return { ok: false, reason: "org_chart_invalid" };
  }
  const cron = (triggers as Record<string, unknown>).cron;
  if (typeof cron !== "string" || cron.length === 0) {
    return { ok: false, reason: "org_chart_invalid" };
  }

  const reportsToRaw = leadRecord.reports_to;
  const reportsTo =
    reportsToRaw === null
      ? null
      : typeof reportsToRaw === "string" && reportsToRaw.length > 0
        ? reportsToRaw
        : null;

  return { ok: true, cron, reportsTo };
}
