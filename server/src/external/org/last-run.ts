/*
 * external/org/last-run.ts — GET /api/external/org/leads/:leadId/last-run.
 *
 * FR-04.06's "visible last-run timestamp" + 3x-cadence staleness display
 * (iterate-2026-08-18-org-route-beat-register). Reads leadwright's
 * `~/.claude/leads/<lead-id>/last-run.json` (contract name (b), decided by
 * leadwright — `{lastRunAt, sessionId}`, stamped when a beat STARTS) and
 * derives the staleness threshold server-side from `triggers.cron`
 * (contract name (c)) via `org-chart-lookup.ts` + `cron.ts`.
 *
 * `staleness` is tri-state (`"fresh" | "stale" | "unknown"`), matching this
 * family's established idiom (`usage.ts`'s `measured: false`) for "can't
 * tell yet" states — never a guessed boolean. `measured: false` (no
 * `last-run.json` at all) is a DIFFERENT, more basic state than
 * `measured: true, staleness: "unknown"` (a last-run timestamp exists but
 * the cadence can't be resolved) — the two must not collapse into one.
 *
 * Status codes:
 *   400 invalid_lead_id     — leadId isn't kebab-case (LEAD_ID_RE)
 *   403 symlink_forbidden   — last-run.json's final component is a symlink
 *   400 path_traversal      — realpath containment failure
 *   502 last_run_invalid    — present but fails the structural check
 *   500 last_run_read_failed — stat/read failure other than ENOENT
 *   200 otherwise (including the not-measured / unknown-cadence states —
 *   those are valid responses, not errors)
 */

import type { Hono } from "hono";
import { readFileSync, lstatSync } from "node:fs";
import path from "node:path";

import { LEAD_ID_RE } from "./_helpers.js";
import { realPathGuard } from "../../core/path-guard.js";
import { readLeadOrgInfo, type LeadOrgInfoResult } from "./org-chart-lookup.js";
import { cronIntervalMs, evaluateStaleness } from "./cron.js";
import type { LastRunResponse } from "../../types/org.js";

export type { CadenceUnresolvedReason, LastRunResponse } from "../../types/org.js";

function isValidLastRunPayload(v: unknown): v is { lastRunAt: string; sessionId: string } {
  if (typeof v !== "object" || v === null) return false;
  const u = v as Record<string, unknown>;
  return (
    typeof u.lastRunAt === "string" &&
    u.lastRunAt.length > 0 &&
    !Number.isNaN(new Date(u.lastRunAt).getTime()) &&
    typeof u.sessionId === "string" &&
    u.sessionId.length > 0
  );
}

export interface LastRunRouteDeps {
  leadsRoot: string;
  /** Injectable for tests; production wires the real lstatSync. */
  lstatSync?: (p: string) => { isSymbolicLink(): boolean };
  /** Injectable for deterministic boundary tests; production wires `() => new Date()`. */
  now?: () => Date;
  /**
   * Pre-fetched cron/reports_to lookup for this lead — when supplied,
   * `lastRunCore` uses it INSTEAD of calling `readLeadOrgInfo` itself.
   * The composite `/api/org/leads` read passes this (via
   * `readAllLeadOrgInfo`, one chart parse for the whole roster); the
   * single-lead secret-gated route omits it and keeps its own self-
   * contained one-lead read (already O(1), not the N+1 this exists to fix).
   */
  orgInfo?: LeadOrgInfoResult;
}

export type LastRunCoreResult =
  | { status: 200; body: LastRunResponse }
  | { status: 400 | 403 | 500 | 502; body: { error: string; leadId?: string; detail?: string } };

/** Pure core — shared by the secret-gated route and the plain-surface proxy. */
export function lastRunCore(deps: LastRunRouteDeps, leadId: string): LastRunCoreResult {
  const { leadsRoot } = deps;
  const lstat = deps.lstatSync ?? ((p: string) => lstatSync(p));
  const now = deps.now ?? (() => new Date());

  if (!LEAD_ID_RE.test(leadId)) {
    return { status: 400, body: { error: "invalid_lead_id", leadId } };
  }

  const absolute = path.join(leadsRoot, leadId, "last-run.json");

  let lst;
  try {
    lst = lstat(absolute);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { status: 200, body: { leadId, measured: false } };
    }
    return {
      status: 500,
      body: { error: "last_run_read_failed", detail: String(err).slice(0, 200) },
    };
  }
  if (lst.isSymbolicLink()) {
    return { status: 403, body: { error: "symlink_forbidden", leadId } };
  }

  const containment = realPathGuard(leadsRoot, absolute);
  if (!containment.ok) {
    return { status: 400, body: { error: "path_traversal", detail: containment.reason } };
  }

  let raw: string;
  try {
    raw = readFileSync(absolute, "utf8");
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code === "ENOENT") {
      return { status: 200, body: { leadId, measured: false } };
    }
    return {
      status: 500,
      body: { error: "last_run_read_failed", detail: String(err).slice(0, 200) },
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { status: 502, body: { error: "last_run_invalid", leadId } };
  }
  if (!isValidLastRunPayload(parsed)) {
    return { status: 502, body: { error: "last_run_invalid", leadId } };
  }

  const { lastRunAt, sessionId } = parsed;
  const nowValue = now();

  const orgInfo = deps.orgInfo ?? readLeadOrgInfo(leadsRoot, leadId);
  if (!orgInfo.ok) {
    return {
      status: 200,
      body: {
        leadId,
        measured: true,
        lastRunAt,
        sessionId,
        staleness: "unknown",
        thresholdMs: null,
        cadenceMs: null,
        cadenceUnresolvedReason: orgInfo.reason,
      },
    };
  }

  const interval = cronIntervalMs(orgInfo.cron, nowValue);
  if (!interval.ok) {
    return {
      status: 200,
      body: {
        leadId,
        measured: true,
        lastRunAt,
        sessionId,
        staleness: "unknown",
        thresholdMs: null,
        cadenceMs: null,
        cadenceUnresolvedReason: "invalid_cron",
      },
    };
  }

  const evaluation = evaluateStaleness(lastRunAt, interval.ms, nowValue);
  return {
    status: 200,
    body: {
      leadId,
      measured: true,
      lastRunAt,
      sessionId,
      staleness: evaluation.staleness,
      thresholdMs: evaluation.thresholdMs,
      cadenceMs: interval.ms,
    },
  };
}

export function registerLastRunRoute(app: Hono, deps: LastRunRouteDeps): void {
  app.get("/api/external/org/leads/:leadId/last-run", async (c) => {
    const result = lastRunCore(deps, c.req.param("leadId"));
    return c.json(result.body, result.status);
  });
}
