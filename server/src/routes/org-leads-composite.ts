/*
 * routes/org-leads-composite.ts — builds the `GET /api/org/leads` response
 * body: one composite roster read over the whole `org-chart.json`, not an
 * N+1 fan-out (iterate spec Design Notes, "One composite endpoint").
 *
 * Composes four already-extracted pure cores per lead (usage, last-run,
 * beat-register health, charter.md read) plus the new `role-extract.ts`
 * text rule. A per-figure read failure degrades that figure to its own
 * `measured: false` / `not-measured` shape — it never fails the whole
 * roster response, and it never fabricates a value.
 */

import type {
  LeadCadenceView,
  LeadNowState,
  LeadRegisterView,
  LeadRoleView,
  LeadRosterEntry,
  OrgChartLeadView,
  UsageResponse,
} from "../types/org.js";
import { usageCore } from "../external/org/usage.js";
import { lastRunCore } from "../external/org/last-run.js";
import { beatRegisterHealthCore, type BeatRegisterHealthCoreResult } from "../external/org/beat-register-health.js";
import { orgFileReadCore, type OrgFileReadDeps } from "../external/org/file-read.js";
import type { LeadOrgInfoResult } from "../external/org/org-chart-lookup.js";
import { cronIntervalMs } from "../external/org/cron.js";
import { extractRoleSentence } from "../external/org/role-extract.js";

export interface LeadRosterBuildDeps {
  leadsRoot: string;
  /** Shared shape across usage/last-run/beat-register — all three route
   *  deps declare the same `(p) => { isSymbolicLink() }` test seam. */
  lstatSync?: (p: string) => { isSymbolicLink(): boolean };
  openSync?: OrgFileReadDeps["openSync"];
  now?: () => Date;
}

function formatCadence(ms: number): string {
  const minutes = ms / 60_000;
  if (minutes < 60) {
    const n = Math.max(1, Math.round(minutes));
    return `every ${n} min`;
  }
  const hours = minutes / 60;
  if (hours < 24) {
    const n = Math.max(1, Math.round(hours));
    return `every ${n} hr${n === 1 ? "" : "s"}`;
  }
  const days = hours / 24;
  const n = Math.max(1, Math.round(days));
  return `every ${n} day${n === 1 ? "" : "s"}`;
}

function buildCadence(orgInfo: LeadOrgInfoResult, now: Date): LeadCadenceView {
  if (!orgInfo.ok) return { measured: false };
  const interval = cronIntervalMs(orgInfo.cron, now);
  if (!interval.ok) return { measured: false };
  return { measured: true, text: formatCadence(interval.ms), cron: orgInfo.cron };
}

/** The `register` roster field's own degrade — a read failure (symlink
 *  refusal, corrupt file, path traversal, read error) is `{status:
 *  "unknown"}`, NEVER `{status: "clear"}` (internal-plan-review finding,
 *  HIGH: `clear` is an assertion "no open entry", not an absence-of-data
 *  marker — collapsing a deliberate security refusal or a corrupt register
 *  into "no problem here" would fabricate exactly the health claim this
 *  field exists to surface honestly). ENOENT (no register file at all) is
 *  already mapped to `200 clear` INSIDE `beatRegisterHealthCore` (mirrors
 *  leadwright's own "no file = clear" reading) — it never reaches this
 *  degrade at all. Deliberately DIFFERENT from `buildNow`'s degrade for the
 *  SAME read failure (`not-measured`, unchanged from before this field
 *  existed) — the Now line's failure semantics are not touched by adding
 *  this sibling field. */
function registerFieldFor(health: BeatRegisterHealthCoreResult, leadId: string): LeadRegisterView {
  return health.status === 200 ? health.body : { leadId, status: "unknown" };
}

function buildNow(
  deps: LeadRosterBuildDeps,
  leadId: string,
  orgInfo: LeadOrgInfoResult,
  health: BeatRegisterHealthCoreResult,
): LeadNowState {
  if (health.status !== 200) return { state: "not-measured" };

  if (health.body.status === "fault") {
    return { state: "needs-attention", reason: "duplicate-session" };
  }
  if (health.body.status === "open") {
    return { state: "running" };
  }

  // status === "clear" — Resting; text + staleness sourced from last-run,
  // taken verbatim (never recomputed here). `orgInfo` was already resolved
  // once for the whole composite request (see `buildLeadRosterEntry`) —
  // passed through so `lastRunCore` doesn't re-parse `org-chart.json` per
  // lead.
  const lastRun = lastRunCore({ leadsRoot: deps.leadsRoot, lstatSync: deps.lstatSync, orgInfo }, leadId);
  if (lastRun.status !== 200) return { state: "not-measured" };
  if (lastRun.body.measured === false) {
    return { state: "resting", lastRun: { measured: false } };
  }
  return {
    state: "resting",
    lastRun: {
      measured: true,
      lastRunAt: lastRun.body.lastRunAt,
      staleness: lastRun.body.staleness,
      cadenceUnresolvedReason: lastRun.body.cadenceUnresolvedReason,
    },
  };
}

function buildRole(deps: LeadRosterBuildDeps, leadId: string): LeadRoleView {
  const result = orgFileReadCore({ leadsRoot: deps.leadsRoot, openSync: deps.openSync }, `${leadId}/charter.md`);
  if (result.status !== 200 || result.kind !== "file") return { measured: false };
  return extractRoleSentence(result.body.toString("utf8"));
}

function buildUsage(deps: LeadRosterBuildDeps, leadId: string): UsageResponse {
  const result = usageCore({ leadsRoot: deps.leadsRoot, lstatSync: deps.lstatSync }, leadId);
  return result.status === 200 ? result.body : { leadId, measured: false };
}

export function buildLeadRosterEntry(
  deps: LeadRosterBuildDeps,
  leadId: string,
  lead: OrgChartLeadView,
  /**
   * `org-chart.json` cron/reports_to lookup for THIS lead, resolved ONCE
   * for the whole roster by the caller (`readAllLeadOrgInfo`) — see the
   * iterate spec's "parses the chart once" composite-read requirement.
   */
  orgInfo: LeadOrgInfoResult,
): LeadRosterEntry {
  const now = deps.now ?? (() => new Date());
  // Read once, feed both `now` (running/needs-attention/clear branching,
  // unchanged) and the `register` field below — was two reads before this
  // field existed (buildNow had its own private call).
  const registerHealth = beatRegisterHealthCore({ leadsRoot: deps.leadsRoot, lstatSync: deps.lstatSync }, leadId);
  return {
    leadId,
    domain: lead.domain,
    name: lead.name,
    reportsTo: lead.reports_to,
    role: buildRole(deps, leadId),
    now: buildNow(deps, leadId, orgInfo, registerHealth),
    cadence: buildCadence(orgInfo, now()),
    usage: buildUsage(deps, leadId),
    register: registerFieldFor(registerHealth, leadId),
  };
}
