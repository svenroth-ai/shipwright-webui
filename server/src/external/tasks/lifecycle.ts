/*
 * external/tasks/lifecycle.ts — POST /tasks/:id/fork, /close, /backlog +
 * DELETE /tasks/:id.
 *
 * fork — clone a task with a parent linkage + emit fresh launch commands.
 * close — `state → done` (terminal).
 * backlog — `state → draft` (FR-01.32, move back to Backlog column).
 * delete — drop the task + cascade-clear scrollback + snapshot.
 *
 * ADR-068-A1 + ADR-087 — DELETE cascade-clears scrollback files +
 * snapshot files. Best-effort; the task delete is the authoritative
 * privacy boundary.
 *
 * CLAUDE.md rule 6 — backlog's `store.persist` returns 409 on ELOCKED
 * (proper-lockfile contention).
 */

import type { Hono } from "hono";

import { buildCopyCommands } from "../../core/launcher.js";
import {
  SdkSessionsStore,
  isBacklogSourceState,
} from "../../core/sdk-sessions-store.js";
import { withLiveSession } from "../_shared/helpers.js";
import { isBoardColumn } from "../../core/board-column.js";

export function registerTasksLifecycle(
  app: Hono,
  deps: {
    store: SdkSessionsStore;
    ptyManager: { get(taskId: string): unknown };
    scrollbackClearBestEffort?: (taskId: string) => Promise<void>;
    snapshotClearBestEffort?: (taskId: string) => Promise<void>;
  },
): void {
  const {
    store,
    ptyManager,
    scrollbackClearBestEffort,
    snapshotClearBestEffort,
  } = deps;

  app.post("/api/external/tasks/:id/fork", async (c) => {
    const parent = store.get(c.req.param("id"));
    if (!parent) return c.json({ error: "Parent task not found" }, 404);
    const body = await c.req.json().catch(() => ({}));
    const title =
      typeof body.title === "string" && body.title.trim()
        ? body.title.trim()
        : `${parent.title} — fork`;
    const child = store.create({
      title,
      cwd: parent.cwd,
      pluginDirs: parent.pluginDirs,
      parentTaskId: parent.taskId,
      parentSessionUuid: parent.sessionUuid,
      // Section 02 — forks inherit the parent's projectId.
      projectId: parent.projectId,
    });
    const commands = buildCopyCommands({
      sessionUuid: child.sessionUuid,
      cwd: child.cwd,
      fork: true,
      parentSessionUuid: parent.sessionUuid,
      pluginDirs: child.pluginDirs,
      title: child.title,
    });
    store.patch(child.taskId, {
      state: "awaiting_external_start",
      launchedAt: new Date().toISOString(),
    });
    await store.persist();
    return c.json({
      task: withLiveSession(store.get(child.taskId), ptyManager),
      commands,
    });
  });

  app.post("/api/external/tasks/:id/close", async (c) => {
    const task = store.get(c.req.param("id"));
    if (!task) return c.json({ error: "Task not found" }, 404);
    // iterate-2026-06-17 — sync boardColumn so a prior manual drag can't
    // strand the closed card outside Done (AC-6).
    const updated = store.patch(task.taskId, { state: "done", boardColumn: "done" });
    await store.persist();
    return c.json({ task: withLiveSession(updated, ptyManager) });
  });

  // iterate-2026-05-17-move-to-backlog (FR-01.32) — move an In-Progress
  // task back to the Backlog column (`state → draft`). A pure registry-
  // state flip, sibling of /close: the JSONL and shipwright_run_config.json
  // are NOT touched. Every history field is preserved; only `state` changes.
  app.post("/api/external/tasks/:id/backlog", async (c) => {
    const task = store.get(c.req.param("id"));
    if (!task) return c.json({ error: "Task not found" }, 404);
    // Already in the Backlog → idempotent no-op.
    if (task.state === "draft") {
      return c.json({ task: withLiveSession(task, ptyManager) });
    }
    // Explicit allowlist of the five In-Progress states.
    if (!isBacklogSourceState(task.state)) {
      return c.json(
        { error: "backlog_invalid_state", state: task.state },
        409,
      );
    }
    const updated = store.patch(task.taskId, { state: "draft", boardColumn: "backlog" });
    try {
      await store.persist();
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ELOCKED") {
        return c.json({ error: "sdk-sessions.json is locked, retry" }, 409);
      }
      throw err;
    }
    return c.json({ task: withLiveSession(updated, ptyManager) });
  });

  // iterate-2026-05-31-reopen-done-task — counterpart of /backlog for the
  // terminal `done` state. Re-opens a done task back to the Backlog column
  // (`state → draft`). `done` is the only legal source: In-Progress states
  // use /backlog, and the flip preserves every history field — sessionUuid +
  // firstJsonlObservedAt survive, so the card renders Resume (continue the
  // completed session), not a fresh Launch. Same pure registry-state flip as
  // /backlog: JSONL + shipwright_run_config.json are NOT touched.
  app.post("/api/external/tasks/:id/reopen", async (c) => {
    const task = store.get(c.req.param("id"));
    if (!task) return c.json({ error: "Task not found" }, 404);
    // Already in the Backlog → idempotent no-op.
    if (task.state === "draft") {
      return c.json({ task: withLiveSession(task, ptyManager) });
    }
    if (task.state !== "done") {
      return c.json(
        { error: "reopen_invalid_state", state: task.state },
        409,
      );
    }
    const updated = store.patch(task.taskId, { state: "draft", boardColumn: "backlog" });
    try {
      await store.persist();
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ELOCKED") {
        return c.json({ error: "sdk-sessions.json is locked, retry" }, 409);
      }
      throw err;
    }
    return c.json({ task: withLiveSession(updated, ptyManager) });
  });

  // iterate-2026-06-17-board-dnd-status-decouple — set the sticky,
  // user-owned board-column override ONLY. `state`, JSONL, and run-config
  // are NEVER touched: the board column is decoupled from session liveness,
  // so a live task can be parked in any column and still offer Resume. This
  // is the canonical command path for drag-and-drop; the menu lifecycle
  // routes above sync boardColumn inline so a prior drag can't strand a card.
  app.post("/api/external/tasks/:id/column", async (c) => {
    const task = store.get(c.req.param("id"));
    if (!task) return c.json({ error: "Task not found" }, 404);
    const body = (await c.req.json().catch(() => ({}))) as { column?: unknown };
    if (!isBoardColumn(body.column)) {
      return c.json({ error: "invalid_column", column: body.column ?? null }, 400);
    }
    const updated = store.patch(task.taskId, { boardColumn: body.column });
    try {
      await store.persist();
    } catch (err) {
      if ((err as NodeJS.ErrnoException)?.code === "ELOCKED") {
        return c.json({ error: "sdk-sessions.json is locked, retry" }, 409);
      }
      throw err;
    }
    return c.json({ task: withLiveSession(updated, ptyManager) });
  });

  app.delete("/api/external/tasks/:id", async (c) => {
    const taskId = c.req.param("id");
    const deleted = store.delete(taskId);
    if (!deleted) return c.json({ error: "Task not found" }, 404);
    await store.persist();
    // ADR-068-A1: cascade-clean scrollback files. Best-effort.
    if (scrollbackClearBestEffort) {
      try {
        await scrollbackClearBestEffort(taskId);
      } catch {
        /* best-effort */
      }
    }
    // ADR-087 MEDIUM-B1: cascade-clean snapshot file. Best-effort —
    // task delete is the authoritative privacy boundary.
    if (snapshotClearBestEffort) {
      try {
        await snapshotClearBestEffort(taskId);
      } catch {
        /* best-effort */
      }
    }
    return c.json({ ok: true });
  });
}
