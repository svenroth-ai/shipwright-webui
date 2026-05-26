/*
 * external/transcript/routes.ts — GET /api/external/tasks/:id/transcript.
 *
 * STATELESS byte-offset read (CLAUDE.md rule 4 + plan-d-double-prime hard
 * rule #2 "Server is stateless on transcript reads"). Multi-tab works by
 * construction — two parallel fetches with the same fromByte +
 * expectFingerprint return identical bytes.
 *
 * Status discriminated union on `status`:
 *   { status: "ok", chunk, task }
 *   { status: "missing", task }
 *   { status: "rotated", task, currentFingerprint }
 *
 * Also drives the active/idle decay state machine — see comments inline
 * for the new-plain pty-up exception (ADR-085) and AWAITING-external-start
 * re-launch path.
 */

import { Hono } from "hono";

import { SessionWatcher } from "../../core/session-watcher.js";
import {
  SdkSessionsStore,
  type ExternalTask,
  type ExternalTaskState,
} from "../../core/sdk-sessions-store.js";

import {
  ACTIVE_IDLE_THRESHOLD_MS,
  IDLE_REACTIVATE_THRESHOLD_MS,
  parseIntSafe,
  withLiveSession,
} from "../_shared/helpers.js";

export interface TranscriptRouterDeps {
  store: SdkSessionsStore;
  watcher: SessionWatcher;
  ptyManager: { get(taskId: string): unknown };
}

export function createTranscriptRouter(deps: TranscriptRouterDeps): Hono {
  const app = new Hono();
  const { store, watcher, ptyManager } = deps;

  app.get("/api/external/tasks/:id/transcript", async (c) => {
    const task = store.get(c.req.param("id"));
    if (!task) return c.json({ error: "Task not found" }, 404);

    const fromByte = parseIntSafe(c.req.query("fromByte"), 0);
    const expectFingerprint = c.req.query("expectFingerprint") ?? null;

    const result = await watcher.readChunk({
      sessionUuid: task.sessionUuid,
      fromByte,
      expectFingerprint,
    });

    // Apply state-machine transitions based on probe outcome + mtime.
    if (result.status === "missing") {
      if (
        task.firstJsonlObservedAt &&
        task.state !== "jsonl_missing" &&
        // iterate-2026-05-17-move-to-backlog (FR-01.32) — a task moved
        // back to the Backlog is sticky: a transient JSONL-probe miss
        // must NOT yank a `draft` task into `jsonl_missing` (which would
        // relocate it out of the Backlog column).
        task.state !== "draft"
      ) {
        store.patch(task.taskId, { state: "jsonl_missing" });
        await store.persist();
      } else if (
        // iterate-2026-05-08 v0.8.7 AC-1 — `new-plain` tasks never write
        // JSONL (per known_issues.md). Without this branch, AC-4's pty-up
        // active-state never decays back to `idle` after pty-kill, so the
        // header CTA stays empty (Resume only renders for state=idle).
        task.actionId === "new-plain" &&
        task.state === "active" &&
        ptyManager.get(task.taskId) === undefined
      ) {
        store.patch(task.taskId, { state: "idle" });
        await store.persist();
      }
      return c.json({
        status: "missing",
        task: withLiveSession(store.get(task.taskId), ptyManager),
      });
    }

    if (result.status === "rotated") {
      return c.json({
        status: "rotated",
        task: withLiveSession(task, ptyManager),
        currentFingerprint: result.currentFingerprint,
      });
    }

    const now = Date.now();
    const loc = await watcher.findByUuid(task.sessionUuid);
    const mtime = loc?.mtimeMs ?? 0;

    const patch: Partial<ExternalTask> = { lastJsonlSeenMtimeMs: mtime };
    let nextState: ExternalTaskState = task.state;
    if (!task.firstJsonlObservedAt) {
      // First JSONL ever observed for this task — record the timestamp
      // regardless of state.
      patch.firstJsonlObservedAt = new Date().toISOString();
      // iterate-2026-05-17-move-to-backlog (FR-01.32 / AC-3) — a task
      // moved back to the Backlog BEFORE its launch produced a JSONL is
      // `draft` with `firstJsonlObservedAt` still unset. When that launch
      // (already dispatched) finally writes a JSONL, this poll must NOT
      // bump the task out of the Backlog into `active`.
      if (!(task.state === "draft" && task.launchedAt)) {
        nextState = "active";
      }
    } else if (
      task.state === "jsonl_missing" ||
      task.state === "awaiting_external_start"
    ) {
      // awaiting_external_start: re-launch / resume case where JSONL
      // already exists from a prior session.
      nextState = "active";
    } else if (
      task.state === "active" &&
      now - mtime > ACTIVE_IDLE_THRESHOLD_MS
    ) {
      // iterate-2026-05-11 v0.9.3 AC-1 (ADR-085) — for `new-plain` tasks
      // the JSONL mtime is meaningless (Claude doesn't write to it until
      // the user types their first message inside the TUI). The
      // AUTHORITATIVE active→idle signal is pty entry gone (the v0.8.7
      // AC-1 path inside the result="missing" branch).
      if (
        task.actionId === "new-plain" &&
        ptyManager.get(task.taskId) !== undefined
      ) {
        // Keep nextState = task.state (active).
      } else {
        nextState = "idle";
      }
    } else if (
      task.state === "idle" &&
      now - mtime <= IDLE_REACTIVATE_THRESHOLD_MS
    ) {
      nextState = "active";
    }
    if (nextState !== task.state) {
      patch.state = nextState;
    }
    store.patch(task.taskId, patch);
    await store.persist();

    return c.json({
      status: "ok",
      chunk: result.chunk,
      task: withLiveSession(store.get(task.taskId), ptyManager),
    });
  });

  return app;
}
