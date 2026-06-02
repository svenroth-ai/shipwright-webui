/*
 * campaigns.ts — webui Campaigns lane route (FR-01.31).
 *
 * One endpoint:
 *   GET /api/campaigns/:projectId — read-only resolved view of every campaign
 *     under `<project>/.shipwright/planning/iterate/campaigns/`.
 *
 * Sibling of `triage.ts` GET (ADR-101): same `getProjectById` dep + realpath
 * traversal guard. Read-only — the webui never writes campaign state
 * (`campaign_init.py` / `campaign_progress.py` own writes).
 *
 * Status mapping:
 *   - unknown / synthesized project id → 404 project_not_found
 *   - path traversal (symlinked campaigns dir escaping the root) → 403
 *   - missing / empty campaigns dir → 200 { campaigns: [] }   (NOT 404)
 *   - otherwise → 200 { campaigns: Campaign[] }
 */

import { Hono } from "hono";

import { resolveCampaignsDir } from "../core/campaign-paths.js";
import { readCampaigns, type Campaign } from "../core/campaign-store.js";

export interface CampaignProjectMeta {
  id: string;
  path: string;
  synthesized?: boolean;
}

export interface CampaignRoutesDeps {
  /** Per-id project lookup. Synthesized rows are treated as 404 by callers. */
  getProjectById: (id: string) => CampaignProjectMeta | undefined;
}

export function createCampaignsRoutes(deps: CampaignRoutesDeps): Hono {
  const app = new Hono();

  app.get("/api/campaigns/:projectId", (c) => {
    const projectId = c.req.param("projectId");
    const project = deps.getProjectById(projectId);
    if (!project || project.synthesized) {
      return c.json({ error: "project_not_found", projectId }, 404);
    }
    const pathRes = resolveCampaignsDir({
      path: project.path,
      synthesized: project.synthesized,
    });
    if (!pathRes.ok) {
      if (pathRes.error.reason === "path_traversal") {
        return c.json({ error: "path_traversal_rejected", projectId }, 403);
      }
      return c.json({ error: "project_path_invalid", projectId }, 404);
    }
    let campaigns: Campaign[];
    try {
      // readCampaigns returns [] for a non-existent dir, so a project with no
      // campaigns yet answers 200 { campaigns: [] } — never 404.
      campaigns = readCampaigns(pathRes.absolute, pathRes.projectRoot);
    } catch (err) {
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "campaigns read failed",
          projectId,
          error: String(err).slice(0, 200),
        }),
      );
      campaigns = [];
    }
    return c.json({ campaigns });
  });

  return app;
}
