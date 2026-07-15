/*
 * external/events/routes.ts — read-only observer of a project's tracked event
 * log (`<project.path>/shipwright_events.jsonl`).
 *
 * Owns: GET /api/external/projects/:projectId/events[?runId=<adr_id>]
 *
 * The WebUI never writes the event log (CLAUDE.md rule 1 / rule 12 spirit —
 * shipwright-iterate / pipeline emitters own every append). No
 * POST/PATCH/PUT/DELETE handler exists; Hono 404s an undeclared
 * method-on-known-path.
 *
 * Response shapes:
 *   200 { status: "ok", ...EventLogProjection }
 *        — an absent/unreadable log yields an ok payload with empty runs +
 *          zero counts (graceful; the reader never throws).
 *   404 { error: "project_not_found", projectId }
 *   400 { error: "project_path_unavailable", projectId }
 *
 * `?runId=<adr_id>` filters `runs` to that single join key (the taskDetail
 * "The Record" view); omit it for the whole project (Ship's-Log runs list).
 *
 * Sourced by core/event-log-reader.ts (path-guarded, tolerant JSONL parse).
 */

import { Hono } from "hono";

import {
  readEventLog,
  type EventLogProjection,
} from "../../core/event-log-reader.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";

export interface EventsRouterDeps {
  getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
  /**
   * Reads + projects a project's event log. Defaults to the real reader;
   * tests inject a stub so they don't touch the filesystem (the reader's own
   * parsing is covered in core/event-log-reader.test.ts).
   */
  readEvents?: (
    projectRoot: string,
    opts?: { runId?: string },
  ) => EventLogProjection;
}

export function createEventsRouter(deps: EventsRouterDeps): Hono {
  const app = new Hono();
  const { getProjectById } = deps;
  const reader =
    deps.readEvents ??
    ((projectRoot: string, opts?: { runId?: string }) =>
      readEventLog(projectRoot, opts));

  app.get("/api/external/projects/:projectId/events", (c) => {
    const projectId = c.req.param("projectId");
    const project = getProjectById?.(projectId);
    if (!project) {
      return c.json({ error: "project_not_found", projectId }, 404);
    }
    if (!project.path) {
      return c.json({ error: "project_path_unavailable", projectId }, 400);
    }

    const runId = c.req.query("runId");
    const projection = reader(
      project.path,
      runId ? { runId } : undefined,
    );
    return c.json({ status: "ok", ...projection });
  });

  return app;
}
