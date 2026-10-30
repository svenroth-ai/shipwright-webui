/*
 * external/actions/upload-delete.ts — DELETE /api/projects/:id/actions-upload.
 *
 * Reset the project to the bundled default by removing its actions.json
 * (central, plus a legacy in-repo copy). Idempotent: returns
 * `{removed: false}` when the file did not exist.
 */

import type { Hono } from "hono";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { realPathGuard } from "../../core/path-guard.js";
import { clearActionsCacheForRecord } from "../../core/project-actions-loader.js";
import { centralDataDir, legacyRepoDataDir, projectDataDir, projectDataGuardRoot } from "../../core/project-data-dir.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";

export function registerActionsUploadDelete(
  app: Hono,
  deps: {
    getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
  },
): void {
  const { getProjectById } = deps;

  app.delete("/api/projects/:id/actions-upload", (c) => {
    const id = c.req.param("id");
    const project = getProjectById?.(id);
    if (!project) {
      return c.json({ error: "project_not_found", projectId: id }, 404);
    }
    if (!project.path) {
      return c.json(
        { error: "project_path_unavailable", projectId: id },
        400,
      );
    }
    // Reset removes the central file AND a legacy in-repo one (otherwise the
    // legacy read-fallback would resurrect the "reset" actions.json).
    const central = projectDataDir(project);
    const targets = [central, legacyRepoDataDir(project), project.shared === true ? centralDataDir(project) : null]
      .filter((d): d is string => !!d)
      .map((d) => ({ dir: d, file: join(d, "actions.json") }))
      .filter((t) => existsSync(t.file));
    if (targets.length === 0) {
      clearActionsCacheForRecord(project);
      return c.json({ path: join(central, "actions.json"), removed: false });
    }
    try {
    for (const t of targets) {
      const guardRoot = t.dir === central ? projectDataGuardRoot(project) : t.dir === legacyRepoDataDir(project) ? project.path : t.dir;
      const guard = realPathGuard(guardRoot, t.file);
      if (!guard.ok) {
        return c.json({ error: "path_unsafe", reason: guard.reason, path: t.file }, 400);
      }
      try {
        unlinkSync(t.file);
      } catch (err) {
        return c.json(
          { error: "upload_unlink_failed", detail: String(err).slice(0, 200), path: t.file },
          500,
        );
      }
    }
    return c.json({ path: targets[0].file, removed: true });
    } finally {
      clearActionsCacheForRecord(project);
    }
  });
}
