/*
 * campaigns.ts — webui Campaigns routes (FR-01.31 / FR-01.33).
 *
 *   GET  /api/campaigns/:projectId          — read-only resolved view of every
 *                                             campaign under the project.
 *   POST /api/campaigns/:projectId/:slug/start — set a campaign's lifecycle
 *                                             status to `active` (the Triage
 *                                             "Start Campaign" action). This is
 *                                             the ONLY WebUI write to campaign
 *                                             state — a narrow, lock-protected,
 *                                             operator-initiated relaxation of
 *                                             the read-only rule (see ADR /
 *                                             core/campaign-write.ts).
 *
 * Status mapping (both routes share the getProjectById + realpath guard from
 * triage.ts / ADR-101): unknown/synth project → 404; traversal → 403; missing
 * campaign dir → 404. Start adds: `complete → 409` (no revert), lock ELOCKED →
 * 503, no writable status target → 422.
 */

import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import path from "node:path";

import { Hono } from "hono";
import type { Context } from "hono";

import { resolveCampaignsDir, isWithin } from "../core/campaign-paths.js";
import { readCampaigns, type Campaign } from "../core/campaign-store.js";
import { readLoopRunState, type LoopRunState } from "../core/campaign-loop-state.js";
import {
  readStatusJson,
  pickLifecycle,
  type CampaignLifecycleStatus,
} from "../core/campaign-status-json.js";
import { parseFrontmatter } from "../core/campaign-parse.js";
import { setCampaignStatus, CampaignWriteError } from "../core/campaign-write.js";

export interface CampaignProjectMeta {
  id: string;
  path: string;
  synthesized?: boolean;
}

export interface CampaignRoutesDeps {
  /** Per-id project lookup. Synthesized rows are treated as 404 by callers. */
  getProjectById: (id: string) => CampaignProjectMeta | undefined;
  /**
   * Cross-process file lock for a campaign dir (collision-safe `.weblock`).
   * Generic web-lock — `createTriageLock()` in production, in-process mutex in
   * tests. Held across the read-modify-write of the lifecycle status.
   */
  lock: (path: string) => Promise<() => Promise<void>>;
}

/** Current lifecycle status, read with the same precedence as pickLifecycle. */
function readCurrentStatus(campaignDir: string): CampaignLifecycleStatus | null {
  const sj = readStatusJson(campaignDir);
  let fm: Record<string, string> = {};
  const mdPath = path.join(campaignDir, "campaign.md");
  if (existsSync(mdPath)) {
    try {
      fm = parseFrontmatter(readFileSync(mdPath, "utf-8"));
    } catch {
      fm = {};
    }
  }
  return pickLifecycle(sj, fm);
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
    // Live-run annotation from loop_state.json, read ONCE so the per-step
    // overlay and the attached-run guard share a consistent snapshot. Tolerant —
    // readLoopRunState never throws, but the guard keeps a torn read from ever
    // 500-ing the route.
    let loop: LoopRunState;
    try {
      loop = readLoopRunState(pathRes.projectRoot, Date.now());
    } catch {
      loop = { attachedSlugs: new Set(), runningStepIdsBySlug: new Map() };
    }
    for (const camp of campaigns) {
      // Per-step overlay (live board feedback): a live loop unit marks its step
      // in_progress on the board even before the producer writes status.json
      // in_progress (monorepo follow-up trg-9edbab4d). Only pending →
      // in_progress; status.json stays authoritative for complete/failed/
      // escalated, so done/total/nextPending are untouched.
      const running = loop.runningStepIdsBySlug.get(camp.slug);
      if (running) {
        for (const s of camp.steps) {
          if (s.status === "pending" && running.has(s.id)) s.status = "in_progress";
        }
      }
      // Attached-run guard (double-launch, FR-01.33): a live loop unit for the
      // slug OR any in_progress step (the overlay above + the future
      // producer-side status.json signal).
      camp.attachedRun =
        loop.attachedSlugs.has(camp.slug) ||
        camp.steps.some((s) => s.status === "in_progress");
    }
    return c.json({ campaigns });
  });

  // POST /api/campaigns/:projectId/:slug/start — draft → active.
  app.post("/api/campaigns/:projectId/:slug/start", async (c) => {
    const projectId = c.req.param("projectId");
    const slug = c.req.param("slug");
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

    // Resolve + guard the campaign dir within the campaigns dir. realpath of a
    // missing path throws ENOENT → 404 (not 500).
    let campaignDir: string;
    try {
      campaignDir = realpathSync(path.join(pathRes.absolute, slug));
    } catch {
      return c.json({ error: "campaign_not_found", projectId, slug }, 404);
    }
    if (!isWithin(pathRes.absolute, campaignDir)) {
      return c.json({ error: "path_traversal_rejected", projectId, slug }, 403);
    }
    try {
      if (!statSync(campaignDir).isDirectory()) {
        return c.json({ error: "campaign_not_found", projectId, slug }, 404);
      }
    } catch {
      return c.json({ error: "campaign_not_found", projectId, slug }, 404);
    }

    let release: () => Promise<void>;
    try {
      release = await deps.lock(campaignDir);
    } catch (err) {
      if (isElockedError(err)) return lockUnavailable(c);
      throw err;
    }
    try {
      // Lifecycle guard INSIDE the lock (authoritative): never revert a
      // completed campaign — re-read under the lock so a producer flipping the
      // campaign to `complete` between request arrival and here can't be
      // overwritten back to `active`. draft / active / legacy-null → proceed
      // (active is idempotent).
      if (readCurrentStatus(campaignDir) === "complete") {
        return c.json({ error: "campaign_already_complete", projectId, slug }, 409);
      }
      setCampaignStatus(campaignDir, "active");
    } catch (err) {
      if (err instanceof CampaignWriteError) {
        return c.json(
          { error: err.code, message: err.message },
          err.code === "no_writable_status_target" ? 422 : 500,
        );
      }
      throw err;
    } finally {
      await releaseQuietly(release);
    }
    return c.json({ slug, status: "active" });
  });

  return app;
}

// ----------------------------------------------------------------------
// Lock-failure classification (mirrors triage.ts / ADR-106).
// ----------------------------------------------------------------------

function isElockedError(err: unknown): boolean {
  return (
    typeof err === "object" &&
    err !== null &&
    (err as { code?: unknown }).code === "ELOCKED"
  );
}

function lockUnavailable(c: Context) {
  return c.json(
    {
      error: "lock_unavailable",
      message: "Campaign storage is busy — please retry in a moment.",
    },
    503,
  );
}

async function releaseQuietly(release: () => Promise<void>): Promise<void> {
  try {
    await release();
  } catch (err) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "campaign route: lock release failed (ignored)",
        error: String(err).slice(0, 200),
      }),
    );
  }
}
