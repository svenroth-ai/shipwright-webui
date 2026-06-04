/*
 * external/launch/_helpers.ts — launch-route branch helpers.
 *
 * Three branches in launch precedence order, one file per branch:
 *   1. ./phase-task-branch.ts — body.phaseTaskRef present (load-bearing
 *      security path; client never dictates sessionUuid / slashCommand).
 *   2. ./action-substitution-branch.ts — actionId present + fresh-start
 *      + project resolvable.
 *   3. ./legacy-fallback-branch.ts — anything else, including dryRun and
 *      resume on an established session.
 *
 * Each helper returns either:
 *   - `{ commands, taskUpdate }` (apply changes, fall through)
 *   - `{ error, status }` (terminate the handler with the documented
 *     status code per `_c2_api_baseline.json`)
 *   - `null` (this branch did not apply; caller falls through)
 */

import type { CopyCommandForms } from "../../core/launcher.js";
import type { ExternalTask } from "../../core/sdk-sessions-store.js";

export type LaunchBranchResult =
  | { commands: CopyCommandForms; taskUpdate: Partial<ExternalTask> }
  | { error: Record<string, unknown>; status: 400 | 404 | 409 };

export { parseLaunchBody, type ParsedLaunchBody } from "./parse-body.js";
export { applyPhaseTaskBranch } from "./phase-task-branch.js";
export { applyCampaignBranch } from "./campaign-branch.js";
export { applyCampaignStepBranch } from "./campaign-step-branch.js";
export { applyActionSubstitutionBranch } from "./action-substitution-branch.js";
export { applyLegacyFallbackBranch } from "./legacy-fallback-branch.js";
