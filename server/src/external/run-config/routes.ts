/*
 * external/run-config/routes.ts — read-only observer of
 * `<project.path>/shipwright_run_config.json`.
 *
 * Owns: GET /api/external/projects/:projectId/run-config
 *
 * CLAUDE.md rule 12 — webui is a READ-ONLY observer of run-config; the
 * framework's orchestrator owns every mutation. No POST/PATCH/PUT/DELETE
 * handler exists on this path; Hono returns 404 for undeclared
 * method-on-known-path (the per-router test locks this).
 *
 * Response shapes (discriminated union on `status`):
 *   { status: "ok", config, readyToLaunchTasks, diagnostics }
 *   { status: "missing" }
 *   { status: "v1_legacy" }
 *   { status: "invalid", reason }
 *
 * `readyToLaunchTasks` is a derived UX convenience (every awaiting_launch
 * task whose prerequisites are completed). The framework's state machine
 * remains the source of truth; phase-task launches re-verify against the
 * full config server-side at launch time.
 */

import { Hono } from "hono";

import {
  readRunConfig as defaultReadRunConfig,
  type RunConfigReadResult,
} from "../../core/run-config-reader.js";
import { deriveReadyToLaunchTasks } from "../../types/run-config-v2.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";

export interface RunConfigRouterDeps {
  getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
  readRunConfig?: (projectPath: string) => Promise<RunConfigReadResult>;
}

export function createRunConfigRouter(deps: RunConfigRouterDeps): Hono {
  const app = new Hono();
  const { getProjectById } = deps;
  const runConfigReader =
    deps.readRunConfig ?? ((p: string) => defaultReadRunConfig(p));

  app.get("/api/external/projects/:projectId/run-config", async (c) => {
    const projectId = c.req.param("projectId");
    const project = getProjectById?.(projectId);
    if (!project) {
      return c.json({ error: "project_not_found", projectId }, 404);
    }
    if (!project.path) {
      return c.json({ error: "project_path_unavailable", projectId }, 400);
    }

    const result = await runConfigReader(project.path);
    if (result.status === "ok") {
      return c.json({
        status: "ok",
        config: result.config,
        readyToLaunchTasks: deriveReadyToLaunchTasks(result.config),
        diagnostics: result.diagnostics,
      });
    }
    if (result.status === "missing" || result.status === "v1_legacy") {
      return c.json({ status: result.status });
    }
    return c.json({ status: "invalid", reason: result.reason });
  });

  return app;
}
