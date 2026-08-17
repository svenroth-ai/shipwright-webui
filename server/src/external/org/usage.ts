/*
 * external/org/usage.ts — GET /api/external/org/leads/:leadId/usage.
 *
 * Punkt 8's consumption read interface: location + shape + refresh cadence,
 * fixed now even though leadwright has no producer for `usage.json` yet
 * (triage doc: "die Form wird trotzdem jetzt festgelegt, weil das
 * Folgepaket V4b an ihr hängt und sich sonst selbst eine improvisiert").
 *
 * Location: `~/.claude/leads/<lead-id>/usage.json` (per-lead — see the
 * iterate spec's design-decision 5). Missing file ⇒ `measured: false`,
 * 200 — this is the steady state before leadwright ships its writer, not
 * an error (contrast `org-chart.ts`, where a missing file IS an error: the
 * chart is expected to already exist).
 *
 * Plan-review fix (both external reviewers, HIGH): `:leadId` is a raw route
 * param and was originally joined into a filesystem path with no
 * validation — a `..`-shaped or separator-bearing leadId could escape
 * `leadsRoot`. Fixed: `leadId` is validated against the SAME `LEAD_ID_RE`
 * the charter-pattern allowlist check uses (one shared validator, not two
 * that could drift), then the resolved path additionally gets a realpath
 * containment check before any read.
 */

import type { Hono } from "hono";
import { readFileSync, lstatSync } from "node:fs";
import path from "node:path";

import { LEAD_ID_RE, LEADS_USAGE_REFRESH_INTERVAL_MS } from "./_helpers.js";
import { realPathGuard } from "../../core/path-guard.js";

export { LEADS_USAGE_REFRESH_INTERVAL_MS };

export type UsageResponse =
  | { leadId: string; measured: false }
  | {
      leadId: string;
      measured: true;
      costUsd: number;
      runCount: number;
      windowDays: number;
      asOf: string;
    };

function isValidUsagePayload(
  v: unknown,
): v is { costUsd: number; runCount: number; windowDays: number; asOf: string } {
  if (typeof v !== "object" || v === null) return false;
  const u = v as Record<string, unknown>;
  return (
    typeof u.costUsd === "number" &&
    Number.isFinite(u.costUsd) &&
    u.costUsd >= 0 &&
    typeof u.runCount === "number" &&
    Number.isFinite(u.runCount) &&
    u.runCount >= 0 &&
    typeof u.windowDays === "number" &&
    Number.isFinite(u.windowDays) &&
    u.windowDays > 0 &&
    typeof u.asOf === "string" &&
    u.asOf.length > 0
  );
}

export interface UsageRouteDeps {
  leadsRoot: string;
  /** Injectable for tests (code-review: this branch was previously
   *  untestable without a real OS symlink). Production wires real lstatSync. */
  lstatSync?: (path: string) => { isSymbolicLink(): boolean };
}

export function registerUsageRoute(app: Hono, deps: UsageRouteDeps): void {
  const { leadsRoot } = deps;
  const lstat = deps.lstatSync ?? ((p: string) => lstatSync(p));

  app.get("/api/external/org/leads/:leadId/usage", async (c) => {
    const leadId = c.req.param("leadId");
    if (!LEAD_ID_RE.test(leadId)) {
      return c.json({ error: "invalid_lead_id", leadId }, 400);
    }

    const absolute = path.join(leadsRoot, leadId, "usage.json");

    // Existence + symlink check BEFORE any read — a missing lead directory
    // (steady state pre-producer) is `measured: false`, not an error; a
    // symlinked final component is rejected before it is ever opened.
    let lst;
    try {
      lst = lstat(absolute);
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === "ENOENT") {
        const body: UsageResponse = { leadId, measured: false };
        return c.json(body, 200);
      }
      return c.json(
        { error: "usage_read_failed", detail: String(err).slice(0, 200) },
        500,
      );
    }
    if (lst.isSymbolicLink()) {
      return c.json({ error: "symlink_forbidden", leadId }, 403);
    }

    // Parent-directory symlink escape (e.g. the lead directory itself is a
    // junction pointing outside leadsRoot) — checked BEFORE reading.
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
        const body: UsageResponse = { leadId, measured: false };
        return c.json(body, 200);
      }
      return c.json(
        { error: "usage_read_failed", detail: String(err).slice(0, 200) },
        500,
      );
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return c.json({ error: "usage_invalid", leadId }, 502);
    }
    if (!isValidUsagePayload(parsed)) {
      return c.json({ error: "usage_invalid", leadId }, 502);
    }

    const body: UsageResponse = {
      leadId,
      measured: true,
      costUsd: parsed.costUsd,
      runCount: parsed.runCount,
      windowDays: parsed.windowDays,
      asOf: parsed.asOf,
    };
    return c.json(body, 200);
  });
}
