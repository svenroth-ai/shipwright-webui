/*
 * external/actions/routes.ts — actions catalog + actions.json read/write
 * registration shell.
 *
 * Owns:
 *   GET    /api/external/projects/:projectId/actions
 *   POST   /api/projects/:id/actions-stub          (NOTE: not /api/external)
 *   POST   /api/projects/:id/actions-upload        (NOTE: not /api/external)
 *   DELETE /api/projects/:id/actions-upload        (NOTE: not /api/external)
 *
 * Path-prefix split (the only one in the API surface): the writable
 * endpoints live under `/api/projects/...` deliberately — they aren't
 * external-launch surface, they're per-project mutation, and the wizard
 * + Settings UI both expect the shorter prefix. Preserved verbatim
 * post-split (see _c2_api_baseline.json `note_path_prefix`).
 *
 * Per-endpoint handlers split into ./get.ts ./stub.ts ./upload.ts
 * ./upload-delete.ts to keep each module ≤ 300 LOC.
 */

import { Hono } from "hono";

import type { PreviewProfile } from "../../core/preview-session-manager.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";

import { registerActionsGet } from "./get.js";
import { registerActionsStub } from "./stub.js";
import { registerActionsUpload } from "./upload.js";
import { registerActionsUploadDelete } from "./upload-delete.js";

export interface ActionsRouterDeps {
  getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
  loadProfile: (profileName: string) => PreviewProfile | null;
}

export function createActionsRouter(deps: ActionsRouterDeps): Hono {
  const app = new Hono();
  registerActionsGet(app, deps);
  registerActionsStub(app, { getProjectById: deps.getProjectById });
  registerActionsUpload(app, { getProjectById: deps.getProjectById });
  registerActionsUploadDelete(app, { getProjectById: deps.getProjectById });
  return app;
}
