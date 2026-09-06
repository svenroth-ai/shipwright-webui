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
import { checkClaimHolderGate } from "./claim-holder-gate.js";
import { commandsCarryPermissionPerimeter } from "./claim-permission-perimeter-assert.js";
import { checkMixedLaunchIntents } from "./mixed-intents-guard.js";

export interface LaunchRouterDeps {
  store: SdkSessionsStore;
  ptyManager: { get(taskId: string): unknown };
  getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
  runConfigReader: (projectPath: string) => Promise<RunConfigReadResult>;
  /**
   * D18/F14+F28 — ground-truth "does `<uuid>.jsonl` exist on disk?" probe.
   * The phase-task + master-run branches emit `--resume` (not a duplicate
   * `--session-id`) when it resolves true, closing the "Session ID already in
   * use" hole where the persisted `firstJsonlObservedAt` lags the disk. Wired
   * from `SessionWatcher.findByUuid` by `createExternalRoutes`; optional so the
   * per-router unit tests that don't wire a watcher default to "no JSONL".
   */
  jsonlExistsOnDisk?: (sessionUuid: string) => Promise<boolean>;
}

export function createLaunchRouter(deps: LaunchRouterDeps): Hono {
  const app = new Hono();
  const { store, ptyManager, getProjectById, runConfigReader, jsonlExistsOnDisk } =
    deps;

  app.post("/api/external/tasks/:id/launch", async (c) => {
    const rawBody = await c.req.json().catch(() => ({}));
    const body: Record<string, unknown> =
      rawBody && typeof rawBody === "object" && !Array.isArray(rawBody)
        ? (rawBody as Record<string, unknown>)
        : {};

    let task = store.get(c.req.param("id"));
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
    // While a task is claimed the launch route MUST step aside for anyone
    // but the claim HOLDER (FR-04.22/V5, iterate-2026-09-03-claim-holder-launch)
    // — so a stranger and the daemon don't fight over the same session
    // (stale SQLite lock, interleaved JSONL, double-running shells), while
    // the holder itself can still (re)launch. External review HIGH-2: only
    // `claimToken` triggers the 409.
    //
    // The in-memory row can be STALE — `load()` runs once at server boot
    // (index.ts), so a foreign claim written to disk by the leadwright
    // daemon only reaches this process's memory via its OWN persist(). A
    // webui that has persisted nothing since the claim was written would
    // otherwise see no claim at all (the normal case for an idle daemon
    // with no browser open). Refresh this one row from disk first — never
    // re-run `load()` (a guarded no-op after the first call).
    const freshTask = await store.refreshRowFromDisk(task.taskId);
    if (freshTask) task = freshTask;

    const bodyClaimToken =
      typeof body.claimToken === "string" ? body.claimToken : undefined;
    const claimGate = checkClaimHolderGate(task, bodyClaimToken);
    if (!claimGate.allowed) {
      return c.json(claimGate.error, 409);
    }
    // FR-04.22 (iterate-2026-09-06-claim-launch-permission-perimeter) —
    // true only for the leadwright stage-2 executor (the ONE caller that
    // ever proves it holds the CURRENT claim). Threaded into BOTH branches
    // a claim-only `{ claimToken }` launch body can actually reach: the
    // action-substitution branch (leadwright always sets `actionId` at
    // task creation — a required field on its side — and parse-body.ts's
    // once-set-always-used contract resolves it from the persisted task
    // even though the launch body carries no `actionId` itself) and the
    // legacy fallback (a task launched before ever having an actionId set).
    // phaseTaskRef/campaignSlug/campaignStep/masterRun are NEVER
    // once-set-always-used (parse-body.ts: "Launch-body only (never
    // persisted)"), so those branches structurally cannot fire for a
    // `{ claimToken }`-only body and are left untouched. Every human/manual
    // launch takes `claimGate.claimAuthorized === false` here, so its
    // command string is unchanged byte-for-byte. See
    // `./claim-executor-permissions.ts` for what gets armed and why.
    const claimAuthorized = claimGate.claimAuthorized;

    // Parse + apply once-set-always-used (v0.4.1 fallback contract).
    const parseResult = parseLaunchBody(body, task);
    if ("error" in parseResult) {
      return c.json(parseResult.error, parseResult.status);
    }
    const parsed = parseResult;

    // FR-01.34 / FR-01.36 / webui-pipeline-convergence W2 — campaignSlug,
    // campaignStep and masterRun are each their own launch intent, mutually
    // exclusive with actionId / phaseTaskRef / each other. See
    // ./mixed-intents-guard.ts.
    const mixedIntents = checkMixedLaunchIntents(body, parsed);
    if (mixedIntents) {
      return c.json(mixedIntents.error, mixedIntents.status);
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
      jsonlExistsOnDisk,
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
        listTasks: () => store.list(),
        jsonlExistsOnDisk,
      });
    }

    // Branch 3 — action substitution.
    if (!branchResult) {
      branchResult = applyActionSubstitutionBranch({
        task,
        parsed,
        effectivelyFreshStart,
        getProjectById,
        claimAuthorized,
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
        claimAuthorized,
      }));
    }

    // FR-04.22 Stage-3 doubt review — a per-branch opt-in (only
    // action-substitution-branch.ts and legacy-fallback-branch.ts take
    // `claimAuthorized`) rests on an assumption about which body shapes
    // leadwright sends today; it is not a code-enforced invariant against a
    // FUTURE body that combines a valid `claimToken` with `phaseTaskRef` /
    // `campaignSlug` / `campaignStep` / `masterRun` and reaches one of the
    // four branches that never learned about claims. This centralized
    // assertion is the actual enforcement: no matter which branch produced
    // `commands`, a claim-authorized launch must carry the permission
    // perimeter on every shell form, or the request is refused — never
    // silently downgraded to an unrestricted command that looks armed
    // because the caller held a claim.
    if (claimAuthorized && !commandsCarryPermissionPerimeter(commands)) {
      return c.json(
        {
          error: "claim_launch_permission_perimeter_missing",
          detail:
            "claim-authorized launch resolved to a branch that did not arm the permission perimeter",
        },
        409,
      );
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
