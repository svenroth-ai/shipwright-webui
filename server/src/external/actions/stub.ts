/*
 * external/actions/stub.ts — POST /api/projects/:id/actions-stub.
 *
 * Creates `<project.path>/.shipwright-webui/actions.json` as an empty structured stub.
 * Only called from the wizard's "Custom" branch; idempotent (second call
 * is a no-op). This is the ONLY write webui performs inside a user's
 * project path that isn't gated by `realPathGuard`, because the
 * destination filename is fixed AND the wizard already chose the project
 * by id (path is server-controlled).
 */

import type { Hono } from "hono";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ExternalRouteProjectView } from "../_shared/helpers.js";

export function registerActionsStub(
  app: Hono,
  deps: {
    getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
  },
): void {
  const { getProjectById } = deps;

  app.post("/api/projects/:id/actions-stub", (c) => {
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
    const dir = join(project.path, ".shipwright-webui");
    const file = join(dir, "actions.json");
    try {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      if (!existsSync(file)) {
        const stub = {
          $schema:
            "https://shipwright.dev/schemas/actions.v1.json (see docs/actions.md)",
          schemaVersion: 1,
          defaults: { autonomy: "guided" },
          actions: [],
          phases: [],
          preview: { enabled: "auto" },
        };
        writeFileSync(file, JSON.stringify(stub, null, 2) + "\n", "utf-8");
      }
      return c.json({ path: file, created: true });
    } catch (err) {
      return c.json(
        {
          error: "stub_write_failed",
          detail: String(err).slice(0, 200),
          path: file,
        },
        500,
      );
    }
  });
}
