/*
 * external/tasks/list-get.ts — GET /api/external/tasks +
 * GET /api/external/tasks/:id.
 *
 * Both endpoints augment serialized tasks with:
 *   - `liveSession` (Iterate G ADR-095) — derived from
 *     `ptyManager.get(taskId) !== undefined`.
 *   - `lastJsonlSeenMtimeMs` (ADR-102) — a LIVE JSONL mtime overlaid on
 *     the persisted store row so the header Resume-CTA gate is not fed a
 *     stale value between transcript polls.
 */

import type { Hono } from "hono";

import { SessionWatcher } from "../../core/session-watcher.js";
import { SdkSessionsStore } from "../../core/sdk-sessions-store.js";
import {
  withLiveJsonlMtime,
  withLiveSession,
} from "../_shared/helpers.js";

export function registerTasksListGet(
  app: Hono,
  deps: {
    store: SdkSessionsStore;
    watcher: SessionWatcher;
    ptyManager: { get(taskId: string): unknown };
  },
): void {
  const { store, watcher, ptyManager } = deps;

  app.get("/api/external/tasks", async (c) => {
    // Section 02 — optional ?projectId=<id> filter. Unvalidated on read
    // (unknown id → empty list, not 400) because an orphaned URL from a
    // deleted project is a benign state, not a user error.
    const filter = c.req.query("projectId");
    // iterate-2026-08-16-v1-lead-fields-tag-filter — optional exact-match
    // ?tag=<value> filter (leadwright triage-v1-v4a.md FR-04.09: a cheap
    // lookup over the interface instead of scanning every session's JSONL).
    // NOT an atomic/idempotent check-and-create (doubt-review finding,
    // Stage 3): unlike findByPhaseTaskId()'s in-request check before
    // store.create(), a GET-then-POST across two daemon requests has a
    // TOCTOU race — duplicate-prevention across concurrent daemon writers
    // is the CALLER's responsibility, not this filter's. c.req.query()
    // takes only the FIRST value on a repeated param, matching ?projectId=.
    // Applied BEFORE findManyByUuid so the per-session filesystem walk sees
    // only the matched tasks.
    const tagFilter = c.req.query("tag");
    const all = store.list();
    let filtered = filter ? all.filter((t) => t.projectId === filter) : all;
    if (tagFilter) filtered = filtered.filter((t) => t.tags?.includes(tagFilter));
    const locs = await watcher.findManyByUuid(
      new Set(filtered.map((t) => t.sessionUuid.toLowerCase())),
    );
    const tasks = filtered.map((t) =>
      withLiveJsonlMtime(
        withLiveSession(t, ptyManager),
        locs.get(t.sessionUuid.toLowerCase())?.mtimeMs,
      ),
    );
    return c.json({ tasks });
  });

  app.get("/api/external/tasks/:id", async (c) => {
    const task = store.get(c.req.param("id"));
    if (!task) return c.json({ error: "Task not found" }, 404);
    const loc = await watcher.findByUuid(task.sessionUuid);
    return c.json({
      task: withLiveJsonlMtime(withLiveSession(task, ptyManager), loc?.mtimeMs),
    });
  });
}
