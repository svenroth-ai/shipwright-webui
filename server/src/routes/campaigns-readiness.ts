/*
 * campaigns-readiness.ts — GET /api/campaigns/:projectId/:slug/readiness.
 *
 * The campaign DAG view's single data source for "which units are launchable
 * and what is each waiting on": the monorepo scheduler's own read-only verdict
 * (`core/campaign-readiness.ts`), passed through verbatim. Deliberately NOT
 * folded into `GET /api/campaigns/:projectId` — that route is polled every 3 s
 * and the readiness command may `git fetch origin`; this one is fetched on
 * demand by the expanded card at a slower cadence and is cached + coalesced
 * server-side.
 *
 * Every computed outcome is HTTP 200 with a `status` discriminator — "no loop
 * running" and "engine unavailable" are states the UI renders, not failures.
 * 404 unknown project, 400 malformed slug, 403 traversal.
 */

import { Hono } from "hono";

import { resolveCampaignsDir } from "../core/campaign-paths.js";
import { getReadiness, type ReadinessDeps } from "../core/campaign-readiness.js";
// The STRICT filesystem-safe slug rule (the route-helpers one is only a map-key
// guard): this slug names a worktree directory.
import { isValidCampaignSlug } from "../external/launch/campaign-branch.js";
import type { CampaignProjectMeta } from "./campaigns.js";

/** Longest the route holds a request; the CLI itself may take up to 90 s. */
const READINESS_ROUTE_MAX_WAIT_MS = 30_000;

export interface CampaignReadinessRouteDeps {
  getProjectById: (id: string) => CampaignProjectMeta | undefined;
  /** Test seam for the spawn / fs / clock; production omits it. */
  readiness?: ReadinessDeps;
}

export function createCampaignReadinessRoutes(deps: CampaignReadinessRouteDeps): Hono {
  const app = new Hono();

  app.get("/api/campaigns/:projectId/:slug/readiness", async (c) => {
    const projectId = c.req.param("projectId");
    const slug = c.req.param("slug");
    const project = deps.getProjectById(projectId);
    if (!project || project.synthesized) {
      return c.json({ error: "project_not_found", projectId }, 404);
    }
    if (!isValidCampaignSlug(slug)) {
      return c.json({ error: "invalid_slug", projectId, slug }, 400);
    }
    const pathRes = resolveCampaignsDir({ path: project.path, synthesized: project.synthesized });
    if (!pathRes.ok) {
      if (pathRes.error.reason === "path_traversal") {
        return c.json({ error: "path_traversal_rejected", projectId }, 403);
      }
      return c.json({ error: "project_path_invalid", projectId }, 404);
    }
    // Bounded so a slow `git fetch` cannot hold the request (and browser
    // connections behind it) for the full CLI timeout; the call keeps running
    // and lands in the cache for the next poll.
    try {
      const outcome = await getReadiness({ projectRoot: pathRes.projectRoot, slug }, deps.readiness, {
        maxWaitMs: READINESS_ROUTE_MAX_WAIT_MS,
      });
      return c.json(outcome === "timeout" ? { status: "failed", reason: "Checking readiness took too long." } : outcome);
    } catch (err) {
      return c.json({ status: "failed", reason: err instanceof Error ? err.message : "Readiness check failed." });
    }
  });

  return app;
}
