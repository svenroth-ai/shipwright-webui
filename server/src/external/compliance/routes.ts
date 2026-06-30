/*
 * external/compliance/routes.ts — read-only observer of
 * `<project.path>/.shipwright/compliance/dashboard.md`.
 *
 * Owns: GET /api/external/projects/:projectId/compliance
 *
 * WebUI never writes the dashboard (CLAUDE.md rule 12 spirit — the
 * shipwright-compliance plugin owns every mutation). No POST/PATCH/PUT/DELETE
 * handler exists; Hono 404s undeclared method-on-known-path.
 *
 * Response shapes (discriminated on `status`):
 *   { status: "ok", grade, score, verdict, generatedAt,
 *     controlVerdictMarkdown, ciSecurityMarkdown }
 *   { status: "missing" }
 *   { status: "invalid", reason }
 *
 * The grade + verdict feed the badge/tooltip; the two markdown slices feed the
 * detail modal (rendered client-side with react-markdown + remark-gfm).
 */

import { Hono } from "hono";

import {
  readCompliance as defaultReadCompliance,
  type ComplianceReadResult,
} from "../../core/compliance-reader.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";

export interface ComplianceRouterDeps {
  getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
  readCompliance?: (projectPath: string) => Promise<ComplianceReadResult>;
}

export function createComplianceRouter(deps: ComplianceRouterDeps): Hono {
  const app = new Hono();
  const { getProjectById } = deps;
  const reader =
    deps.readCompliance ?? ((p: string) => defaultReadCompliance(p));

  app.get("/api/external/projects/:projectId/compliance", async (c) => {
    const projectId = c.req.param("projectId");
    const project = getProjectById?.(projectId);
    if (!project) {
      return c.json({ error: "project_not_found", projectId }, 404);
    }
    if (!project.path) {
      return c.json({ error: "project_path_unavailable", projectId }, 400);
    }

    const result = await reader(project.path);
    if (result.status === "ok") {
      return c.json({ status: "ok", ...result.data });
    }
    if (result.status === "missing") {
      return c.json({ status: "missing" });
    }
    return c.json({ status: "invalid", reason: result.reason });
  });

  return app;
}
