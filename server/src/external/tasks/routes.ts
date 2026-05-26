/*
 * external/tasks/routes.ts — task lifecycle registration shell.
 *
 * Owns:
 *   POST   /api/external/tasks                  (create.ts)
 *   GET    /api/external/tasks                  (list-get.ts)
 *   GET    /api/external/tasks/:id              (list-get.ts)
 *   PATCH  /api/external/tasks/:id              (patch.ts)
 *   POST   /api/external/tasks/:id/fork         (lifecycle.ts)
 *   POST   /api/external/tasks/:id/close        (lifecycle.ts)
 *   POST   /api/external/tasks/:id/backlog      (lifecycle.ts)
 *   DELETE /api/external/tasks/:id              (lifecycle.ts)
 *
 * Per-endpoint handlers split into siblings to keep this shell ≤ 300 LOC.
 */

import { Hono } from "hono";

import { SessionWatcher } from "../../core/session-watcher.js";
import { SdkSessionsStore } from "../../core/sdk-sessions-store.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";

import { registerTasksCreate } from "./create.js";
import { registerTasksListGet } from "./list-get.js";
import { registerTasksPatch } from "./patch.js";
import { registerTasksLifecycle } from "./lifecycle.js";

export interface TasksRouterDeps {
  store: SdkSessionsStore;
  watcher: SessionWatcher;
  ptyManager: { get(taskId: string): unknown };
  getKnownProjectIds?: () => Set<string>;
  getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
  scrollbackClearBestEffort?: (taskId: string) => Promise<void>;
  snapshotClearBestEffort?: (taskId: string) => Promise<void>;
}

export function createTasksRouter(deps: TasksRouterDeps): Hono {
  const app = new Hono();
  registerTasksCreate(app, {
    store: deps.store,
    ptyManager: deps.ptyManager,
    getKnownProjectIds: deps.getKnownProjectIds,
    getProjectById: deps.getProjectById,
  });
  registerTasksListGet(app, {
    store: deps.store,
    watcher: deps.watcher,
    ptyManager: deps.ptyManager,
  });
  registerTasksPatch(app, {
    store: deps.store,
    ptyManager: deps.ptyManager,
    getKnownProjectIds: deps.getKnownProjectIds,
    getProjectById: deps.getProjectById,
  });
  registerTasksLifecycle(app, {
    store: deps.store,
    ptyManager: deps.ptyManager,
    scrollbackClearBestEffort: deps.scrollbackClearBestEffort,
    snapshotClearBestEffort: deps.snapshotClearBestEffort,
  });
  return app;
}
