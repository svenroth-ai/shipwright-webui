/*
 * external/launch/routes.ts — POST /api/external/tasks/:id/launch.
 *
 * The launch handler dispatches across three branches in precedence
 * order. Each branch lives in its own file to keep this shell ≤ 300 LOC:
 *
 *   1. ./phase-task-branch.ts        — body.phaseTaskRef present
 *   2. ./action-substitution-branch.ts — actionId + fresh-start + project
 *   3. ./legacy-fallback-branch.ts    — terminal default
 *
 * CLAUDE.md rule 13 — `phaseTaskRef` flows through server-side
 * verification (session uuid pre-bound at create-time + run-config
 * cross-check). Mismatched uuids → 409 `phase_task_session_uuid_mismatch`.
 * `phaseTaskRef + actionId` → 400 `mixed_launch_intents`.
 */

import { Hono } from "hono";

import {
  SdkSessionsStore,
  type ExternalTask,
} from "../../core/sdk-sessions-store.js";
import type { RunConfigReadResult } from "../../core/run-config-reader.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";
import { withLiveSession } from "../_shared/helpers.js";
import {
  parseLaunchBody,
  applyPhaseTaskBranch,
  applyActionSubstitutionBranch,
  applyLegacyFallbackBranch,
  type LaunchBranchResult,
} from "./_helpers.js";

export interface LaunchRouterDeps {
  store: SdkSessionsStore;
  ptyManager: { get(taskId: string): unknown };
  getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
  runConfigReader: (projectPath: string) => Promise<RunConfigReadResult>;
}

export function createLaunchRouter(deps: LaunchRouterDeps): Hono {
  const app = new Hono();
  const { store, ptyManager, getProjectById, runConfigReader } = deps;

  app.post("/api/external/tasks/:id/launch", async (c) => {
    const rawBody = await c.req.json().catch(() => ({}));
    const body: Record<string, unknown> =
      rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
        ? (rawBody as Record<string, unknown>)
        : {};

    const task = store.get(c.req.param("id"));
    if (!task) return c.json({ error: "Task not found" }, 404);

    // Section 03 (iterate 3) — O20 idempotency guard. Reject re-launch on
    // a terminal `done` task (resume after close is almost always
    // unintended). `launch_failed` is accepted (user retrying clipboard).
    const dryRunPeek = Boolean(body.dryRun);
    if (task.state === "done" && !dryRunPeek) {
      return c.json(
        { error: "launch_invalid_state", state: task.state },
        409,
      );
    }

    // iterate-2026-05-14 lead-foundation-task-schema (leadwright Phase 1).
    // While a task is claimed the user-level launch route MUST step aside
    // so user + daemon don't fight over the same session (stale SQLite
    // lock, interleaved JSONL, double-running shells). External review
    // HIGH-2: only `claimToken` triggers the 409.
    if (typeof task.claimToken === "string" && task.claimToken.length > 0) {
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "task_claimed: launch refused while claimToken is set",
          taskId: task.taskId,
          claimedBy: task.claimedBy,
          claimedAt: task.claimedAt,
          claimPid: task.claimPid,
        }),
      );
      return c.json(
        {
          error: "task_claimed",
          claimedBy: task.claimedBy,
          claimedAt: task.claimedAt,
        },
        409,
      );
    }

    // Parse + apply once-set-always-used (v0.4.1 fallback contract).
    const parseResult = parseLaunchBody(body, task);
    if ("error" in parseResult) {
      return c.json(parseResult.error, parseResult.status);
    }
    const parsed = parseResult;

    // iterate-2026-05-18-fix-resume-description — a Resume click on a
    // task whose Claude conversation was never established (no
    // <uuid>.jsonl ever observed on disk → there is nothing to resume)
    // is semantically a FRESH start. Route it through the substitution
    // branch so the brief + slash command are injected exactly like a
    // direct Launch. A genuine resume (JSONL on disk) stays on the
    // description-free `--resume` shape.
    const jsonlObserved = Boolean(task.firstJsonlObservedAt);
    const effectivelyFreshStart =
      !parsed.resume || (!jsonlObserved && !parsed.dryRun);

    // Branch 1 — phaseTaskRef (load-bearing security path).
    const phaseResult = await applyPhaseTaskBranch({
      task,
      parsed,
      getProjectById,
      runConfigReader,
    });
    let branchResult: LaunchBranchResult | null = phaseResult;

    // Branch 2 — action substitution.
    if (!branchResult) {
      branchResult = applyActionSubstitutionBranch({
        task,
        parsed,
        effectivelyFreshStart,
        getProjectById,
      });
    }

    // If a branch produced an error envelope, terminate.
    if (branchResult && "error" in branchResult) {
      return c.json(branchResult.error, branchResult.status);
    }

    // Branch 3 — legacy fallback. Always populates.
    let commands;
    let taskUpdate: Partial<ExternalTask>;
    if (branchResult) {
      ({ commands, taskUpdate } = branchResult);
    } else {
      ({ commands, taskUpdate } = applyLegacyFallbackBranch({
        task,
        parsed,
        jsonlObserved,
      }));
    }

    if (parsed.dryRun) {
      // Pure command-string build — no state mutation, no persist.
      return c.json({ task: withLiveSession(task, ptyManager), commands });
    }
    const updated = store.patch(task.taskId, taskUpdate);
    await store.persist();
    return c.json({
      task: withLiveSession(updated, ptyManager),
      commands,
    });
  });

  return app;
}
