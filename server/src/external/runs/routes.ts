/*
 * external/runs/routes.ts — read-only observer of a project's per-run facts,
 * joined from the tracked event log (`<project.path>/shipwright_events.jsonl`).
 * A02, campaign webui-wow-usability-2026-07-10 (consumes A01's reader).
 *
 * Owns:
 *   GET /api/external/projects/:projectId/runs         (logbook list + pipeline agg)
 *   GET /api/external/projects/:projectId/runs/:runId   (Record-rail detail)
 *   GET /api/external/projects/:projectId/grade-trend   (grade_snapshot series)
 *
 * WebUI never writes the event log (CLAUDE.md rule 1 / rule 12 spirit). No
 * POST/PATCH/PUT/DELETE handler exists; Hono 404s an undeclared method.
 *
 * Response shapes:
 *   /runs        200 { status:"ok", runs, runCount, gradeTrend, pipelinePhaseDurations, skippedLines }
 *   /runs/:runId 200 { status:"ok", run: RunDataJoin | null }
 *                    — an UNKNOWN runId is a graceful `run: null` (200), NOT a
 *                      404: the join degrades, never throws (spec AC1/AC2).
 *   /grade-trend 200 { status:"ok", gradeTrend }
 *   404 { error:"project_not_found", projectId } · 400 { error:"project_path_unavailable", projectId }
 *
 * An absent/unreadable log yields an ok payload with empty runs/[] (graceful).
 * Sourced by core/run-data-join.ts (path-guarded, tolerant JSONL parse).
 */

import { Hono, type Context } from "hono";

import {
  readRunData,
  type RunDataBundle,
} from "../../core/run-data-join.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";

export interface RunsRouterDeps {
  getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
  /**
   * Reads + joins a project's event log into the run-data bundle. Defaults to
   * the real reader; tests inject a stub so they don't touch the filesystem
   * (the join's own semantics are covered in core/run-data-join.test.ts).
   */
  readRunData?: (
    projectRoot: string,
    opts?: { runId?: string },
  ) => RunDataBundle;
}

export function createRunsRouter(deps: RunsRouterDeps): Hono {
  const app = new Hono();
  const { getProjectById } = deps;
  const reader =
    deps.readRunData ??
    ((projectRoot: string, opts?: { runId?: string }) =>
      readRunData(projectRoot, opts));

  /** Resolve the project or return the matching error Response. */
  const resolve = (c: Context): { path: string } | Response => {
    const projectId = c.req.param("projectId") ?? "";
    const project = getProjectById?.(projectId);
    if (!project) {
      return c.json({ error: "project_not_found", projectId }, 404);
    }
    if (!project.path) {
      return c.json({ error: "project_path_unavailable", projectId }, 400);
    }
    return { path: project.path };
  };

  app.get("/api/external/projects/:projectId/runs", (c) => {
    const r = resolve(c);
    if (r instanceof Response) return r;
    const bundle = reader(r.path);
    return c.json({ status: "ok", ...bundle });
  });

  app.get("/api/external/projects/:projectId/runs/:runId", (c) => {
    const r = resolve(c);
    if (r instanceof Response) return r;
    const runId = c.req.param("runId");
    const bundle = reader(r.path, { runId });
    const run = bundle.runs.length > 0 ? bundle.runs[0] : null;
    return c.json({ status: "ok", run });
  });

  app.get("/api/external/projects/:projectId/grade-trend", (c) => {
    const r = resolve(c);
    if (r instanceof Response) return r;
    const bundle = reader(r.path);
    return c.json({ status: "ok", gradeTrend: bundle.gradeTrend });
  });

  return app;
}
