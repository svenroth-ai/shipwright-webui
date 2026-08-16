/*
 * _lead-fields-tag-filter-harness.ts —
 * iterate-2026-08-16-v1-lead-fields-tag-filter (triage-v1-v4a.md Item 1).
 *
 * Shared in-memory Hono harness for the three
 * routes.lead-fields-tag-filter-*.test.ts sibling files (patch / create /
 * list) — split out of a single 313-line test file to clear the bloat gate
 * (300-line guideline). Not the shared `_routes-edit-fields-harness.ts`:
 * these tests need direct access to `deps` (reload round-trip) and the
 * `watcher` instance (findManyByUuid spy) that the shared harness does not
 * expose.
 */
import { Hono } from "hono";

import {
  SdkSessionsStore,
  type SdkSessionsStoreDeps,
} from "../core/sdk-sessions-store.js";
import { SessionWatcher } from "../core/session-watcher.js";
import { createExternalRoutes } from "./routes.js";

export const STORE_PATH = "/store/sdk-sessions.json";

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

export function makeApp(store: SdkSessionsStore, watcher: SessionWatcher): Hono {
  const app = new Hono();
  app.route(
    "/",
    createExternalRoutes({
      store,
      watcher,
      ptyManager: { get: () => undefined },
    }),
  );
  return app;
}
