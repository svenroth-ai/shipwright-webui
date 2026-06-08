/*
 * external/launch/campaign-branch.ts — applyCampaignBranch (FR-01.34).
 *
 * Branch 2 in launch precedence (phaseTaskRef → campaign → action → legacy):
 * `parsed.campaignSlug` present + fresh-start. Builds the autonomous campaign
 * launch command ENTIRELY server-side:
 *
 *   claude --session-id <uuid> --add-dir <cwd> --name '<title>' \
 *     '/shipwright-iterate --campaign <slug> --autonomous'
 *
 * The client only ever sends a slug — never the command (Architecture rule 1 /
 * regression guard #19). The slug is the untrusted→trusted boundary; it is
 * (a) regex-validated, (b) existence-checked against the realpath-guarded
 * campaigns dir, and (c) per-shell quoted by core/launcher.ts. Three guards.
 *
 * Returns `null` when there is no campaignSlug OR the launch is a genuine
 * resume (JSONL on disk) — a resume injects no slash command, so it falls
 * through to the legacy `--resume` branch.
 */

import { existsSync, realpathSync } from "node:fs";
import path from "node:path";

import { buildCopyCommands } from "../../core/launcher.js";
import {
  resolveCampaignsDir,
  isWithin,
} from "../../core/campaign-paths.js";
import { readLoopAttachments } from "../../core/campaign-loop-state.js";
import {
  type ExternalTask,
  type ExternalTaskState,
} from "../../core/sdk-sessions-store.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";
import type { ParsedLaunchBody } from "./parse-body.js";
import type { LaunchBranchResult } from "./_helpers.js";

/**
 * Campaign slug = a campaign directory name. Date-prefixed kebab plus the
 * filesystem-safe set `[A-Za-z0-9._-]`. No spaces, quotes, shell metacharacters,
 * path separators, or `..` — those would either break out of the quoted launch
 * positional or escape the campaigns dir. Capped to a sane filename length.
 */
const CAMPAIGN_SLUG_PATTERN = /^[A-Za-z0-9._-]{1,128}$/;

export function isValidCampaignSlug(slug: string): boolean {
  return CAMPAIGN_SLUG_PATTERN.test(slug) && !slug.includes("..");
}

export function applyCampaignBranch(args: {
  task: ExternalTask;
  parsed: ParsedLaunchBody;
  effectivelyFreshStart: boolean;
  getProjectById:
    | ((id: string) => ExternalRouteProjectView | undefined)
    | undefined;
}): LaunchBranchResult | null {
  const { task, parsed, effectivelyFreshStart, getProjectById } = args;
  if (!parsed.campaignSlug) return null; // not a campaign launch
  // A resume injects no slash command — fall through to the legacy --resume
  // shape (`claude --resume <uuid>` rebuilds the campaign session from JSONL).
  if (!effectivelyFreshStart) return null;

  const slug = parsed.campaignSlug;
  if (!isValidCampaignSlug(slug)) {
    return { error: { error: "invalid_campaign_slug", detail: "slug fails /^[A-Za-z0-9._-]{1,128}$/" }, status: 400 };
  }

  // Defense-in-depth: the slug must resolve to a real campaign dir under the
  // realpath-guarded campaigns tree. Never launch an autonomous run for a
  // campaign that does not exist (or one reached via a symlink escape).
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
  const campaignDir = path.join(resolved.absolute, slug);
  let dirOk = false;
  try {
    dirOk = existsSync(campaignDir) && isWithin(resolved.absolute, realpathSync(campaignDir));
  } catch {
    dirOk = false;
  }
  if (!dirOk) {
    return { error: { error: "campaign_not_found", detail: slug }, status: 400 };
  }

  // Double-launch guard (server enforcement, not just the client CTA): refuse to
  // build a second autonomous command while a live orchestrator is already
  // attached to this campaign (a `loop_state.json` in_progress unit). Two
  // orchestrators race worktrees/commits + corrupt status.json. This closes the
  // multi-tab / deploy-skew / direct-API holes the client `attachedRun` flag
  // cannot. Resume is unaffected — it returned null above. The stale-window in
  // readLoopAttachments keeps a crashed loop from blocking forever.
  if (readLoopAttachments(resolved.projectRoot, Date.now()).has(slug)) {
    return { error: { error: "campaign_run_already_attached", detail: slug }, status: 409 };
  }

  const commands = buildCopyCommands({
    sessionUuid: task.sessionUuid,
    cwd: task.cwd,
    pluginDirs: task.pluginDirs,
    title: task.title,
    slashCommand: `/shipwright-iterate --campaign ${slug} --autonomous`,
  });
  const taskUpdate: Partial<ExternalTask> = {
    state: "awaiting_external_start" as ExternalTaskState,
    launchedAt: new Date().toISOString(),
  };
  return { commands, taskUpdate };
}
