/*
 * external/launch/campaign-step-branch.ts — applyCampaignStepBranch (FR-01.36).
 *
 * Branch 2.5 in launch precedence (phaseTaskRef → campaign → campaignStep →
 * action → legacy): `parsed.campaignStep` present + fresh-start. One-click
 * launch of a SINGLE campaign sub-iterate — builds, ENTIRELY server-side:
 *
 *   claude --session-id <uuid> --add-dir <cwd> --name '<title>' \
 *     '/shipwright-iterate "<specPath>"'
 *
 * The client sends only `{ slug, stepId }` — never the command or the path
 * (Architecture rule 1 / regression guard #19). Three guards on the untrusted
 * input: slug + stepId are regex-validated, the slug must resolve to a real
 * campaign dir under the realpath-guarded campaigns tree, and the step's
 * `specPath` is resolved by the SAME `readCampaigns` reader the board renders
 * (so the launched path is byte-identical to what the user saw + already
 * carries `deriveSpecMeta`'s symlink/escape/shell-hostile-char guards).
 *
 * Returns `null` when there is no campaignStep OR the launch is a genuine
 * resume (JSONL on disk) — a resume injects no slash command, so it falls
 * through to the legacy `--resume` branch.
 */

import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

import { buildCopyCommands } from "../../core/launcher.js";
import { resolveCampaignsDir, isWithin } from "../../core/campaign-paths.js";
import { readCampaigns } from "../../core/campaign-store.js";
import {
  type ExternalTask,
  type ExternalTaskState,
} from "../../core/sdk-sessions-store.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";
import { isValidCampaignSlug } from "./campaign-branch.js";
import type { ParsedLaunchBody } from "./parse-body.js";
import type { LaunchBranchResult } from "./_helpers.js";

/**
 * Campaign step id = a Sub-Iterates table ID cell (e.g. `B0`, `C1`). Same
 * filesystem-safe alphabet as the slug — it forms half of the `<id>-<slug>.md`
 * spec filename — but shorter. No spaces, separators, quotes, or `..`.
 */
const CAMPAIGN_STEP_ID_PATTERN = /^[A-Za-z0-9._-]{1,64}$/;

export function isValidCampaignStepId(id: string): boolean {
  return CAMPAIGN_STEP_ID_PATTERN.test(id) && !id.includes("..");
}

export function applyCampaignStepBranch(args: {
  task: ExternalTask;
  parsed: ParsedLaunchBody;
  effectivelyFreshStart: boolean;
  getProjectById:
    | ((id: string) => ExternalRouteProjectView | undefined)
    | undefined;
}): LaunchBranchResult | null {
  const { task, parsed, effectivelyFreshStart, getProjectById } = args;
  const step = parsed.campaignStep;
  if (!step) return null; // not a campaign-step launch
  // A resume injects no slash command — fall through to the legacy --resume shape.
  if (!effectivelyFreshStart) return null;

  if (!isValidCampaignSlug(step.slug)) {
    return { error: { error: "invalid_campaign_slug", detail: "slug fails /^[A-Za-z0-9._-]{1,128}$/" }, status: 400 };
  }
  if (!isValidCampaignStepId(step.stepId)) {
    return { error: { error: "invalid_campaign_step_id", detail: "stepId fails /^[A-Za-z0-9._-]{1,64}$/" }, status: 400 };
  }

  const project = getProjectById?.(task.projectId);
  if (!project) {
    return { error: { error: "campaign_not_found", detail: "project not resolvable" }, status: 400 };
  }
  const resolved = resolveCampaignsDir({
    path: project.path,
    synthesized: project.synthesized,
  });
  if (!resolved.ok) {
    return { error: { error: "campaign_not_found", detail: resolved.error.reason }, status: 400 };
  }

  // The slug must resolve to a real campaign dir under the realpath-guarded
  // campaigns tree (defense-in-depth; mirrors the autonomous branch).
  const campaignDir = path.join(resolved.absolute, step.slug);
  let dirOk = false;
  try {
    dirOk = existsSync(campaignDir) && isWithin(resolved.absolute, realpathSync(campaignDir));
  } catch {
    dirOk = false;
  }
  if (!dirOk) {
    return { error: { error: "campaign_not_found", detail: step.slug }, status: 400 };
  }

  // Resolve the step's specPath via the SAME reader the board uses — no second
  // derivation that could drift from what the user clicked.
  const campaign = readCampaigns(resolved.absolute, resolved.projectRoot).find(
    (c) => c.slug === step.slug,
  );
  const found = campaign?.steps.find((s) => s.id === step.stepId);
  if (!found) {
    return { error: { error: "campaign_step_not_found", detail: step.stepId }, status: 400 };
  }
  if (!found.specPath) {
    return { error: { error: "campaign_step_spec_missing", detail: step.stepId }, status: 400 };
  }

  const commands = buildCopyCommands({
    sessionUuid: task.sessionUuid,
    cwd: task.cwd,
    pluginDirs: task.pluginDirs,
    title: task.title,
    slashCommand: `/shipwright-iterate "${found.specPath}"`,
  });
  const taskUpdate: Partial<ExternalTask> = {
    state: "awaiting_external_start" as ExternalTaskState,
    launchedAt: new Date().toISOString(),
  };
  return { commands, taskUpdate };
}
