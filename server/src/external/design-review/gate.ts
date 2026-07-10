/*
 * external/design-review/gate.ts —
 * GET /api/external/projects/:projectId/design-gate.
 *
 * Read-only observer that answers "is this run paused at the design
 * orchestrator-approve gate, with mockups ready to review?" (AC1). Combines the
 * single-session loop-state (`run-loop-state-reader.ts`) with the run-config
 * (`readRunConfig`) and the on-disk viewer, all read-only. Never mutates.
 *
 * Response: { active, phaseTaskId, phase } (INACTIVE_DESIGN_GATE shape when not
 * paused-at-design or the viewer is absent).
 */

import { Hono } from "hono";
import { existsSync } from "node:fs";
import path from "node:path";

import {
  readLoopState,
  deriveDesignGate,
  INACTIVE_DESIGN_GATE,
} from "../../core/run-loop-state-reader.js";
import type { RunConfigReadResult } from "../../core/run-config-reader.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";

export interface DesignGateDeps {
  getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
  readRunConfig: (projectPath: string) => Promise<RunConfigReadResult>;
}

/** `.shipwright/designs/index.html` — the emitted review viewer. */
export function viewerPath(projectPath: string): string {
  return path.join(projectPath, ".shipwright", "designs", "index.html");
}

export function registerDesignGate(app: Hono, deps: DesignGateDeps): void {
  const { getProjectById, readRunConfig } = deps;

  app.get("/api/external/projects/:projectId/design-gate", async (c) => {
    const projectId = c.req.param("projectId");
    const project = getProjectById?.(projectId);
    if (!project) {
      return c.json({ error: "project_not_found", projectId }, 404);
    }
    if (!project.path) {
      return c.json({ error: "project_path_unavailable", projectId }, 400);
    }

    const cfgResult = await readRunConfig(project.path);
    const config = cfgResult.status === "ok" ? cfgResult.config : null;
    const loopState = readLoopState(project.path);
    const hasViewer = existsSync(viewerPath(project.path));

    const gate = deriveDesignGate(loopState, config, hasViewer);
    return c.json(gate ?? INACTIVE_DESIGN_GATE);
  });
}
