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
import { readLeadOrgInfo, type LeadOrgInfoReason } from "./org-chart-lookup.js";
import { cronIntervalMs, evaluateStaleness, type Staleness } from "./cron.js";

export type CadenceUnresolvedReason = LeadOrgInfoReason | "invalid_cron";

export type LastRunResponse =
  | { leadId: string; measured: false }
  | {
      leadId: string;
      measured: true;
      lastRunAt: string;
      sessionId: string;
      staleness: Staleness | "unknown";
      thresholdMs: number | null;
      cadenceMs: number | null;
      cadenceUnresolvedReason?: CadenceUnresolvedReason;
    };

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
}

export function registerLastRunRoute(app: Hono, deps: LastRunRouteDeps): void {
  const { leadsRoot } = deps;
  const lstat = deps.lstatSync ?? ((p: string) => lstatSync(p));
  const now = deps.now ?? (() => new Date());

  app.get("/api/external/org/leads/:leadId/last-run", async (c) => {
    const leadId = c.req.param("leadId");
    if (!LEAD_ID_RE.test(leadId)) {
      return c.json({ error: "invalid_lead_id", leadId }, 400);
    }

    const absolute = path.join(leadsRoot, leadId, "last-run.json");

    let lst;
    try {
      lst = lstat(absolute);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        const body: LastRunResponse = { leadId, measured: false };
        return c.json(body, 200);
      }
      return c.json(
        { error: "last_run_read_failed", detail: String(err).slice(0, 200) },
        500,
      );
    }
    if (lst.isSymbolicLink()) {
      return c.json({ error: "symlink_forbidden", leadId }, 403);
    }

    const containment = realPathGuard(leadsRoot, absolute);
    if (!containment.ok) {
      return c.json({ error: "path_traversal", detail: containment.reason }, 400);
    }

    let raw: string;
    try {
      raw = readFileSync(absolute, "utf8");
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        const body: LastRunResponse = { leadId, measured: false };
        return c.json(body, 200);
      }
      return c.json(
        { error: "last_run_read_failed", detail: String(err).slice(0, 200) },
        500,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return c.json({ error: "last_run_invalid", leadId }, 502);
    }
    if (!isValidLastRunPayload(parsed)) {
      return c.json({ error: "last_run_invalid", leadId }, 502);
    }

    const { lastRunAt, sessionId } = parsed;
    const nowValue = now();

    const orgInfo = readLeadOrgInfo(leadsRoot, leadId);
    if (!orgInfo.ok) {
      const body: LastRunResponse = {
        leadId,
        measured: true,
        lastRunAt,
        sessionId,
        staleness: "unknown",
        thresholdMs: null,
        cadenceMs: null,
        cadenceUnresolvedReason: orgInfo.reason,
      };
      return c.json(body, 200);
    }

    const interval = cronIntervalMs(orgInfo.cron, nowValue);
    if (!interval.ok) {
      const body: LastRunResponse = {
        leadId,
        measured: true,
        lastRunAt,
        sessionId,
        staleness: "unknown",
        thresholdMs: null,
        cadenceMs: null,
        cadenceUnresolvedReason: "invalid_cron",
      };
      return c.json(body, 200);
    }

    const evaluation = evaluateStaleness(lastRunAt, interval.ms, nowValue);
    const body: LastRunResponse = {
      leadId,
      measured: true,
      lastRunAt,
      sessionId,
      staleness: evaluation.staleness,
      thresholdMs: evaluation.thresholdMs,
      cadenceMs: interval.ms,
    };
    return c.json(body, 200);
  });
}
