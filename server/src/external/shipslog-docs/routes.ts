/*
 * external/shipslog-docs/routes.ts — read-only observer surface for the
 * Ship's-Log Documents panel (iterate-2026-08-31-shipslog-documents-panel).
 *
 * Owns:
 *   GET /api/external/projects/:projectId/shipslog-docs
 *     200 { status:"ok", requirements, iterateSpecs, agentDocs, compliance }
 *     404 { error:"project_not_found", projectId }
 *     400 { error:"project_path_unavailable", projectId }
 *
 * No POST/PATCH/PUT/DELETE handler exists — WebUI never writes these docs
 * from this surface (CLAUDE.md rule 1 spirit). Sourced by
 * core/shipslog-docs-reader.ts, which owns the path-guard discipline.
 */

import { Hono, type Context } from "hono";

import { readShipsLogDocs, type ShipsLogDocsBundle } from "../../core/shipslog-docs-reader.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";

export interface ShipsLogDocsRouterDeps {
  getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
  /** Defaults to the real fs-backed reader; tests inject a stub. */
  readShipsLogDocs?: (projectRoot: string) => Promise<ShipsLogDocsBundle>;
}

export function createShipsLogDocsRouter(deps: ShipsLogDocsRouterDeps): Hono {
  const app = new Hono();
  const { getProjectById } = deps;
  const reader = deps.readShipsLogDocs ?? readShipsLogDocs;

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

  app.get("/api/external/projects/:projectId/shipslog-docs", async (c) => {
    const r = resolve(c);
    if (r instanceof Response) return r;
    const bundle = await reader(r.path);
    return c.json({ status: "ok", ...bundle });
  });

  return app;
}
