/* Read-only project model-tier endpoint. Framework config is never mutated here. */

import { Hono } from "hono";

import {
  readModelTierConfig as defaultReadModelTierConfig,
  type ModelTierConfigReadResult,
} from "../../core/model-tier-config-reader.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";

export interface ModelConfigRouterDeps {
  getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
  readModelTierConfig?: (projectPath: string) => ModelTierConfigReadResult;
}

export function createModelConfigRouter(deps: ModelConfigRouterDeps): Hono {
  const app = new Hono();
  const reader = deps.readModelTierConfig ?? defaultReadModelTierConfig;
  app.get("/api/external/projects/:projectId/model-config", (c) => {
    const projectId = c.req.param("projectId");
    const project = deps.getProjectById?.(projectId);
    if (!project) return c.json({ error: "project_not_found", projectId }, 404);
    if (!project.path) return c.json({ error: "project_path_unavailable", projectId }, 400);
    return c.json(reader(project.path));
  });
  return app;
}
