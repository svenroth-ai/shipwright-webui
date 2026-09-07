/*
 * org-chart-full-read.ts — a FULL-fidelity read of org-chart.json, distinct
 * from org-chart.ts's parseOrgChart (deliberately narrow 5-field mirror for
 * the existing GET /org-chart route — see types/org.ts's header comment:
 * "widening it is explicitly out of scope"). The verdict/commit routes
 * (iterate-2026-09-07-leadwright-setup-wizard, W14) need every
 * PreflightLead field to build a correct merged proposal — trusting the
 * on-disk shape lightly (this file is only ever written by this app's own
 * lock-protected commit route or by leadwright's daemon, both already
 * validated at their own write time) rather than re-validating leadwright's
 * full schema here ("never re-implement leadwright's validation").
 */
import { readFileSync, lstatSync } from "node:fs";
import path from "node:path";

import type { PreflightOrgChart } from "../../types/leadwright-preflight.js";

export interface OrgChartFullReadDeps {
  leadsRoot: string;
  lstatSync?: (path: string) => { isSymbolicLink(): boolean };
}

export type OrgChartFullReadResult =
  | { status: 200; body: PreflightOrgChart }
  | { status: 403 | 404 | 500 | 502; body: { error: string; detail?: string } };

export function readOrgChartFull(deps: OrgChartFullReadDeps): OrgChartFullReadResult {
  const { leadsRoot } = deps;
  const lstat = deps.lstatSync ?? ((p: string) => lstatSync(p));
  const target = path.join(leadsRoot, "org-chart.json");

  try {
    if (lstat(target).isSymbolicLink()) {
      return { status: 403, body: { error: "symlink_forbidden" } };
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      return { status: 500, body: { error: "org_chart_stat_failed", detail: String(err).slice(0, 200) } };
    }
  }

  let raw: string;
  try {
    raw = readFileSync(target, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { status: 404, body: { error: "org_chart_missing" } };
    }
    return { status: 500, body: { error: "org_chart_read_failed", detail: String(err).slice(0, 200) } };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 502, body: { error: "org_chart_invalid" } };
  }
  if (
    typeof parsed !== "object" ||
    parsed === null ||
    Array.isArray(parsed) ||
    typeof (parsed as { leads?: unknown }).leads !== "object" ||
    (parsed as { leads?: unknown }).leads === null ||
    Array.isArray((parsed as { leads?: unknown }).leads)
  ) {
    return { status: 502, body: { error: "org_chart_invalid" } };
  }

  return { status: 200, body: parsed as PreflightOrgChart };
}
