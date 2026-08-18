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
 *
 * CodeQL js/file-system-race fix: a separate lstat-check + a later,
 * independent readFileSync(path) leaves a window where the final path
 * component could be swapped for a symlink between the two syscalls —
 * mirrors `file-read.ts`'s fix. Open ONCE with O_NOFOLLOW (the kernel
 * atomically refuses a symlinked final component with ELOOP, closing the
 * gap) and fstat/read the SAME fd, so what gets parsed is provably what
 * got checked.
 */

import { closeSync, constants as fsConstants, fstatSync, openSync, readFileSync } from "node:fs";
import path from "node:path";

export type LeadOrgInfoReason =
  | "org_chart_missing"
  | "org_chart_symlink"
  | "org_chart_invalid"
  | "lead_not_found";

export type LeadOrgInfoResult =
  | { ok: true; cron: string; reportsTo: string | null }
  | { ok: false; reason: LeadOrgInfoReason };

export function readLeadOrgInfo(
  leadsRoot: string,
  leadId: string,
  /** Test seam for the O_NOFOLLOW open below (e.g. to simulate an ELOOP a
   *  mocked final-component symlink would produce, without needing a REAL
   *  symlink on disk). Defaults to the real `openSync`. */
  openSyncFn: typeof openSync = openSync,
): LeadOrgInfoResult {
  const target = path.join(leadsRoot, "org-chart.json");

  let fd: number;
  try {
    fd = openSyncFn(target, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { ok: false, reason: "org_chart_missing" };
    }
    if (code === "ELOOP") {
      return { ok: false, reason: "org_chart_symlink" };
    }
    return { ok: false, reason: "org_chart_invalid" };
  }

  let raw: string;
  try {
    if (!fstatSync(fd).isFile()) {
      return { ok: false, reason: "org_chart_invalid" };
    }
    raw = readFileSync(fd, "utf8");
  } catch {
    return { ok: false, reason: "org_chart_invalid" };
  } finally {
    closeSync(fd);
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
