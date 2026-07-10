/*
 * external/design-review/routes.ts — the single-session design-gate mockup
 * review surface (iterate-2026-07-10-design-gate-review-host, FR-01.45).
 *
 * Mounted by external/routes.ts. Three cohesive, read-mostly handlers:
 *   - GET  /api/external/projects/:projectId/design-gate        (gate.ts)
 *   - GET  /api/external/projects/:projectId/designs/:rest{.+}  (serve.ts)
 *   - POST /api/external/projects/:projectId/design-feedback    (feedback-write.ts)
 *
 * The gate + serve handlers are read-only observers; the POST writes ONLY the
 * transient `design-feedback-round{N}.md` scratch file (never run_config /
 * run_loop_state / Claude JSONL).
 */

import { Hono } from "hono";

import { registerDesignGate } from "./gate.js";
import { registerDesignServe } from "./serve.js";
import { registerDesignFeedbackWrite } from "./feedback-write.js";
import type { RunConfigReadResult } from "../../core/run-config-reader.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";

export interface DesignReviewRouterDeps {
  getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
  readRunConfig: (projectPath: string) => Promise<RunConfigReadResult>;
}

export function createDesignReviewRouter(deps: DesignReviewRouterDeps): Hono {
  const app = new Hono();
  registerDesignGate(app, deps);
  registerDesignServe(app, deps);
  registerDesignFeedbackWrite(app, deps);
  return app;
}
