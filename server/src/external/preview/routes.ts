/*
 * external/preview/routes.ts — POST /api/external/projects/:projectId/preview.
 *
 * Spawns a dev server for the project via the injected PreviewSessionManager.
 *
 * ADR-044 / CLAUDE.md rule 9 — Preview spawn uses `shell: false`. User-
 * controlled `dev_server.command` + `shell: true` would be command-
 * injection. All Preview subprocess entrypoints flow through
 * `core/preview-session-manager.ts`. This route is just the policy gate
 * (profile-required, project-required) + the structured error mapping.
 *
 * Structured error codes — the UI maps each to a specific toast:
 *   preview_unavailable      (501) — no previewManager wired (e.g. CLI build)
 *   preview_profile_invalid  (400) — command contains shell operators / empty
 *   preview_spawn_failed     (500) — spawn threw (ENOENT etc.)
 *   preview_port_in_use      (500) — port probe reported EADDRINUSE
 *   preview_exited_early     (500) — child emitted exit before ready
 *   preview_timeout          (500) — no ready signal within timeout
 *   preview_unknown_error    (500) — defensive catch-all
 */

import { Hono } from "hono";

import {
  PreviewExitedEarlyError,
  PreviewPortInUseError,
  PreviewProfileInvalidError,
  PreviewSessionManager,
  PreviewSpawnFailedError,
  PreviewTimeoutError,
  type PreviewProfile,
} from "../../core/preview-session-manager.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";

export interface PreviewRouterDeps {
  getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
  previewManager?: PreviewSessionManager;
  loadProfile: (profileName: string) => PreviewProfile | null;
}

export function createPreviewRouter(deps: PreviewRouterDeps): Hono {
  const app = new Hono();
  const { getProjectById, previewManager, loadProfile } = deps;

  app.post("/api/external/projects/:projectId/preview", async (c) => {
    if (!previewManager) {
      return c.json({ error: "preview_unavailable" }, 501);
    }
    const projectId = c.req.param("projectId");
    const project = getProjectById?.(projectId);
    if (!project) {
      return c.json({ error: "project_not_found", projectId }, 404);
    }
    if (!project.profile) {
      return c.json(
        { error: "preview_profile_invalid", detail: "project has no profile" },
        400,
      );
    }
    const profile = loadProfile(project.profile);
    if (!profile) {
      return c.json(
        { error: "preview_profile_invalid", detail: "profile not found" },
        400,
      );
    }
    try {
      const entry = await previewManager.spawn(projectId, profile, {
        cwd: project.path,
      });
      return c.json({ url: entry.url, sessionId: entry.sessionId });
    } catch (err) {
      if (err instanceof PreviewProfileInvalidError) {
        return c.json(
          { error: "preview_profile_invalid", detail: err.detail },
          400,
        );
      }
      if (err instanceof PreviewPortInUseError) {
        return c.json(
          { error: "preview_port_in_use", port: err.port },
          500,
        );
      }
      if (err instanceof PreviewSpawnFailedError) {
        return c.json(
          { error: "preview_spawn_failed", detail: err.detail },
          500,
        );
      }
      if (err instanceof PreviewExitedEarlyError) {
        return c.json(
          { error: "preview_exited_early", detail: `exited with code ${err.code}` },
          500,
        );
      }
      if (err instanceof PreviewTimeoutError) {
        return c.json(
          { error: "preview_timeout", seconds: err.seconds },
          500,
        );
      }
      // Unknown failure — bubble as a generic 500 so a bug doesn't
      // masquerade as one of the expected codes.
      return c.json(
        { error: "preview_unknown_error", detail: String(err).slice(0, 200) },
        500,
      );
    }
  });

  return app;
}
