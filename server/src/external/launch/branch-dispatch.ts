/*
 * external/launch/branch-dispatch.ts — the precedence-ordered branch chain of
 * POST /api/external/tasks/:id/launch, extracted from routes.ts so the route
 * shell stays ≤ 300 LOC. Pure dispatch: no HTTP, no persistence.
 *
 * Precedence: phaseTaskRef → campaign → campaign-step → master-run →
 * action-substitution → legacy fallback (always populates).
 */

import type { ExternalTask } from "../../core/sdk-sessions-store.js";
import type { RunConfigReadResult } from "../../core/run-config-reader.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";
import {
  applyPhaseTaskBranch,
  applyCampaignBranch,
  applyCampaignStepBranch,
  applyMasterRunBranch,
  applyActionSubstitutionBranch,
  applyLegacyFallbackBranch,
  type LaunchBranchResult,
  type ParsedLaunchBody,
} from "./_helpers.js";

export interface BranchDispatchInput {
  task: ExternalTask;
  parsed: ParsedLaunchBody;
  getProjectById?: (id: string) => ExternalRouteProjectView | undefined;
  runConfigReader: (projectPath: string) => Promise<RunConfigReadResult>;
  jsonlExistsOnDisk?: (sessionUuid: string) => Promise<boolean>;
  listTasks: () => ExternalTask[];
  claimAuthorized: boolean;
}

export async function dispatchLaunchBranches(
  input: BranchDispatchInput,
): Promise<LaunchBranchResult> {
  const {
    task,
    parsed,
    getProjectById,
    runConfigReader,
    jsonlExistsOnDisk,
    listTasks,
    claimAuthorized,
  } = input;

  // iterate-2026-05-18-fix-resume-description — a Resume click on a task
  // whose Claude conversation was never established (no <uuid>.jsonl ever
  // observed on disk → there is nothing to resume) is semantically a FRESH
  // start. Route it through the substitution branch so the brief + slash
  // command are injected exactly like a direct Launch. A genuine resume
  // (JSONL on disk) stays on the description-free `--resume` shape.
  const jsonlObserved = Boolean(task.firstJsonlObservedAt);
  const effectivelyFreshStart =
    !parsed.resume || (!jsonlObserved && !parsed.dryRun);

  // Branch 1 — phaseTaskRef (load-bearing security path).
  let result: LaunchBranchResult | null = await applyPhaseTaskBranch({
    task,
    parsed,
    getProjectById,
    runConfigReader,
    jsonlExistsOnDisk,
  });

  // Branch 2 — campaign autonomous launch (FR-01.34). Command built
  // server-side from a validated slug; null when no campaignSlug / a resume.
  result ??= applyCampaignBranch({
    task,
    parsed,
    effectivelyFreshStart,
    getProjectById,
  });

  // Branch 2.5 — single-sub-iterate launch (FR-01.36).
  result ??= applyCampaignStepBranch({
    task,
    parsed,
    effectivelyFreshStart,
    getProjectById,
  });

  // Branch 2.6 — single-session master launch (campaign
  // webui-pipeline-convergence W2), gated on a readable single_session
  // run_config; null when no masterRun / a resume.
  result ??= await applyMasterRunBranch({
    task,
    parsed,
    effectivelyFreshStart,
    getProjectById,
    runConfigReader,
    listTasks,
    jsonlExistsOnDisk,
  });

  // Branch 3 — action substitution.
  result ??= applyActionSubstitutionBranch({
    task,
    parsed,
    effectivelyFreshStart,
    getProjectById,
    claimAuthorized,
  });

  if (result) return result;

  // Branch 4 — legacy fallback. Always populates.
  return applyLegacyFallbackBranch({
    task,
    parsed,
    jsonlObserved,
    claimAuthorized,
  });
}
