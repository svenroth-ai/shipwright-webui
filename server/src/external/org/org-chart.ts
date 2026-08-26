/*
 * external/org/org-chart.ts — GET /api/external/org/org-chart.
 *
 * A NAMED, TYPED read of `~/.claude/leads/org-chart.json`, distinct from
 * the generic byte-serving `/file` route (`org-chart.json` is not reachable
 * there — see `file-read.ts`). "Named response form" per the triage doc:
 * this is a LIGHTWEIGHT STRUCTURAL MIRROR of the shape
 * `leadwright/lib/org-chart.ts`'s `.strict()` Zod schema produces
 * (`reports_to` / `manages` / `domain` / `name` / `charter_path`), NOT a
 * re-implementation of its write-time invariants (cycle detection,
 * kebab-case id regexes, `escalation_target` validity, `max_concurrent_tasks`
 * literal-1) — those stay leadwright's job (CLAUDE.md rule 7's cross-package
 * mirror discipline, applied across the repo boundary: shared shapes are
 * verbatim mirrors, not imports, and not full ports).
 *
 * The one bar this DOES enforce: a malformed file produces an ERROR, never
 * a half structure (missing/absent file included — it is a setup problem,
 * not the "not yet measured" steady state `usage.ts` models).
 *
 * Status codes:
 *   403 symlink_forbidden — final path component is a symlink
 *   404 org_chart_missing
 *   502 org_chart_invalid — present but fails the structural check
 *   500 read/stat failure
 */

import type { Hono } from "hono";
import { readFileSync, lstatSync } from "node:fs";
import path from "node:path";

import type { OrgChartLeadView, OrgChartView } from "../../types/org.js";

export type { OrgChartLeadView, OrgChartView } from "../../types/org.js";

function isValidLead(v: unknown): v is OrgChartLeadView {
  if (typeof v !== "object" || v === null) return false;
  const lead = v as Record<string, unknown>;
  return (
    typeof lead.domain === "string" &&
    typeof lead.name === "string" &&
    (lead.reports_to === null || typeof lead.reports_to === "string") &&
    Array.isArray(lead.manages) &&
    lead.manages.every((m) => typeof m === "string") &&
    typeof lead.charter_path === "string"
  );
}

/** Structural-only check — NOT the full leadwright Zod schema. See file header. */
export function parseOrgChart(raw: string): OrgChartView | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const obj = parsed as Record<string, unknown>;
  if (typeof obj.version !== "number") return null;
  if (typeof obj.po !== "string" || obj.po.length === 0) return null;
  // External-review fix (MEDIUM, bug): `typeof [] === "object"` is true, so
  // an array-valued `leads` passed this check and Object.entries() on it
  // silently produced an index-keyed Record instead of the declared
  // id-keyed shape (e.g. `{"leads":[]}` was accepted as valid).
  if (typeof obj.leads !== "object" || obj.leads === null || Array.isArray(obj.leads)) {
    return null;
  }

  const leadsIn = obj.leads as Record<string, unknown>;
  const leads: Record<string, OrgChartLeadView> = {};
  for (const [id, lead] of Object.entries(leadsIn)) {
    if (!isValidLead(lead)) return null;
    leads[id] = lead;
  }

  return { version: obj.version, po: obj.po, leads };
}

export interface OrgChartRouteDeps {
  leadsRoot: string;
  /** Injectable for tests (external-review fix: this route previously did
   *  no symlink check at all — production wires the real lstatSync). */
  lstatSync?: (path: string) => { isSymbolicLink(): boolean };
}

export type OrgChartCoreResult =
  | { status: 200; body: OrgChartView }
  | { status: 403 | 404 | 500 | 502; body: { error: string; detail?: string } };

/**
 * Pure core — no Hono dependency, so both the secret-gated
 * `/api/external/org/org-chart` route AND the plain-surface `/api/org/*`
 * proxy (browser-facing, no secret, see `server/src/routes/org.ts`) share
 * this ONE implementation of the symlink/containment/parse guards
 * (Internal Plan Review fix — the guards previously lived only inside this
 * handler closure and could not have been reused without duplication).
 */
export function orgChartCore(deps: OrgChartRouteDeps): OrgChartCoreResult {
  const { leadsRoot } = deps;
  const lstat = deps.lstatSync ?? ((p: string) => lstatSync(p));
  const target = path.join(leadsRoot, "org-chart.json");

  // External-review fix (HIGH, security): this named endpoint previously
  // went straight to readFileSync (follows symlinks) with no lstat check
  // and no realpath containment guard — a symlinked org-chart.json could
  // serve an arbitrary external file's contents through this authenticated
  // route if it happened to satisfy the lightweight structural shape.
  try {
    if (lstat(target).isSymbolicLink()) {
      return { status: 403, body: { error: "symlink_forbidden" } };
    }
  } catch (err) {
    const code = (err as NodeJS.ErrnoException)?.code;
    if (code !== "ENOENT") {
      return {
        status: 500,
        body: { error: "org_chart_stat_failed", detail: String(err).slice(0, 200) },
      };
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
    return {
      status: 500,
      body: { error: "org_chart_read_failed", detail: String(err).slice(0, 200) },
    };
  }

  const orgChart = parseOrgChart(raw);
  if (!orgChart) {
    return { status: 502, body: { error: "org_chart_invalid" } };
  }

  return { status: 200, body: orgChart };
}

export function registerOrgChartRoute(app: Hono, deps: OrgChartRouteDeps): void {
  app.get("/api/external/org/org-chart", async (c) => {
    const result = orgChartCore(deps);
    return c.json(result.body, result.status);
  });
}
