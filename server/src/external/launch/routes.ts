/*
 * external/launch/routes.ts — POST /api/external/tasks/:id/launch.
 *
 * The launch handler dispatches across branches in precedence order.
 * Each branch lives in its own file to keep this shell ≤ 300 LOC:
 *
 *   1. ./phase-task-branch.ts        — body.phaseTaskRef present
 *   2. ./campaign-branch.ts          — body.campaignSlug + fresh-start (FR-01.34)
 *   2.5 ./campaign-step-branch.ts    — body.campaignStep + fresh-start (FR-01.36)
 *   2.6 ./master-run-branch.ts       — body.masterRun + fresh-start + single_session
 *                                      run_config (campaign webui-pipeline-convergence W2)
 *   3. ./action-substitution-branch.ts — actionId + fresh-start + project
 *   4. ./legacy-fallback-branch.ts    — terminal default
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
  applyCampaignBranch,
  applyCampaignStepBranch,
  applyMasterRunBranch,
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

    // FR-01.34 — campaign autonomous launch is its own intent. Reject an
    // EXPLICIT-body mix with actionId / phaseTaskRef (mirrors the existing
    // phaseTaskRef+actionId rule). Checked on the raw body so a task's
    // once-set-always-used persisted actionId never spuriously trips it.
    if (
      typeof body.campaignSlug === "string" &&
      body.campaignSlug.trim().length > 0 &&
      (body.actionId !== undefined || body.phaseTaskRef !== undefined)
    ) {
      return c.json(
        {
          error: "mixed_launch_intents",
          detail: "campaignSlug is mutually exclusive with actionId / phaseTaskRef",
        },
        400,
      );
    }

    // FR-01.36 — a single-sub-iterate launch is its own intent too. Reject a
    // mix with actionId / phaseTaskRef / campaignSlug. Presence is the parsed
    // (well-formed) campaignStep so a malformed body never trips it.
    if (
      parsed.campaignStep &&
      (body.actionId !== undefined ||
        body.phaseTaskRef !== undefined ||
        (typeof body.campaignSlug === "string" && body.campaignSlug.trim().length > 0))
    ) {
      return c.json(
        {
          error: "mixed_launch_intents",
          detail: "campaignStep is mutually exclusive with actionId / phaseTaskRef / campaignSlug",
        },
        400,
      );
    }

    // Campaign webui-pipeline-convergence W2 — a single-session master launch is
    // its own intent. Reject a mix with any other explicit intent. Checked on
    // the raw body (`parsed.masterRun` is derived from `body.masterRun`, which is
    // never persisted) so a once-set-always-used field can't spuriously trip it.
    if (
      Boolean(body.masterRun) &&
      (body.actionId !== undefined ||
        body.phaseTaskRef !== undefined ||
        (typeof body.campaignSlug === "string" && body.campaignSlug.trim().length > 0) ||
        body.campaignStep !== undefined)
    ) {
      return c.json(
        {
          error: "mixed_launch_intents",
          detail:
            "masterRun is mutually exclusive with actionId / phaseTaskRef / campaignSlug / campaignStep",
        },
        400,
      );
    }

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

    // Branch 2 — campaign autonomous launch (FR-01.34). Command built
    // server-side from a validated slug; null when no campaignSlug / a resume.
    if (!branchResult) {
      branchResult = applyCampaignBranch({
        task,
        parsed,
        effectivelyFreshStart,
        getProjectById,
      });
    }

    // Branch 2.5 — single-sub-iterate launch (FR-01.36). Command built
    // server-side from a validated { slug, stepId }; null when no campaignStep
    // / a resume.
    if (!branchResult) {
      branchResult = applyCampaignStepBranch({
        task,
        parsed,
        effectivelyFreshStart,
        getProjectById,
      });
    }

    // Branch 2.6 — single-session master launch (campaign
    // webui-pipeline-convergence W2). Command built server-side (`/shipwright-run`)
    // gated on a readable single_session run_config; null when no masterRun / a
    // resume (→ legacy `--resume <masterUuid>`).
    if (!branchResult) {
      branchResult = await applyMasterRunBranch({
        task,
        parsed,
        effectivelyFreshStart,
        getProjectById,
        runConfigReader,
      });
    }

    // Branch 3 — action substitution.
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

    // Branch 4 — legacy fallback. Always populates.
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
