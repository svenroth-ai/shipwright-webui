/*
 * external/actions/upload-delete.ts — DELETE /api/projects/:id/actions-upload.
 *
 * Reset the project to the bundled default by removing
 * `<project.path>/.webui/actions.json`. Idempotent: returns
 * `{removed: false}` when the file did not exist.
 */

import type { Hono } from "hono";
import { existsSync, unlinkSync } from "node:fs";
import { join } from "node:path";

import { realPathGuard } from "../../core/path-guard.js";
import { clearActionsCacheForProject } from "../../core/project-actions-loader.js";
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
    const file = join(project.path, ".webui", "actions.json");
    if (!existsSync(file)) {
      clearActionsCacheForProject(project.path);
      return c.json({ path: file, removed: false });
    }
    const guard = realPathGuard(project.path, file);
    if (!guard.ok) {
      return c.json(
        { error: "path_unsafe", reason: guard.reason, path: file },
        400,
      );
    }
    try {
      unlinkSync(file);
    } catch (err) {
      return c.json(
        {
          error: "upload_unlink_failed",
          detail: String(err).slice(0, 200),
          path: file,
        },
        500,
      );
    }
    clearActionsCacheForProject(project.path);
    return c.json({ path: file, removed: true });
  });
}
