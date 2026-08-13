/*
 * _routes-edit-fields-harness.ts — shared in-memory Hono + SdkSessionsStore
 * harness for the POST/PATCH /api/external/tasks field-editing gates. NOT a
 * test file (no `.test.` segment, so vitest does not collect it); the
 * leading underscore marks it as test-support, matching the
 * `_triage-api-harness.ts` convention.
 *
 * Extracted from `routes.edit-fields.test.ts` (iterate-2026-08-13-task-
 * description-length-cap) when a second file needed the same setup —
 * keeps both under the 300-line convention instead of duplicating ~35
 * lines of wiring.
 */
import { Hono } from "hono";

import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
} from "../core/sdk-sessions-store.js";
import { SessionWatcher } from "../core/session-watcher.js";
import { createExternalRoutes, type ExternalRouteProjectView } from "./routes.js";

export function inMemoryDeps(): SdkSessionsStoreDeps {
  const files = new Map<string, string>();
  const existing = new Set<string>();
  return {
    readFile: async (p) => {
      if (!files.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files.get(p)!;
    },
    writeFile: async (p, data) => { files.set(p, data); existing.add(p); },
    existsSync: (p) => existing.has(p),
    mkdirSync: (p) => { existing.add(p); },
    ensureFile: (p) => { if (!files.has(p)) files.set(p, ""); existing.add(p); },
  };
}

export const PROJECT: ExternalRouteProjectView = {
  id: "p1",
  name: "Project One",
  path: "/fake/project-one",
};

export function makeApp(store: SdkSessionsStore): Hono {
  const app = new Hono();
  app.route(
    "/",
    createExternalRoutes({
      store,
      watcher: new SessionWatcher({ projectsDir: "/fake/projects" }),
      ptyManager: { get: () => undefined },
      getKnownProjectIds: () => new Set([PROJECT.id]),
      getProjectById: (id) => (id === PROJECT.id ? PROJECT : undefined),
    }),
  );
  return app;
}

export const STORE_PATH = "/store/sdk-sessions.json";
