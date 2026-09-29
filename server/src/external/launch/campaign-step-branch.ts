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
import { readLoopAttachments } from "../../core/campaign-loop-state.js";
import { getReadiness } from "../../core/campaign-readiness.js";
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

/** Serve a cached verdict up to this old; else wait (bounded) for a fresh one. */
export const STEP_READINESS_MAX_AGE_MS = 15_000;
export const STEP_READINESS_MAX_WAIT_MS = 10_000;

export async function applyCampaignStepBranch(args: {
  task: ExternalTask;
  parsed: ParsedLaunchBody;
  effectivelyFreshStart: boolean;
  getProjectById:
    | ((id: string) => ExternalRouteProjectView | undefined)
    | undefined;
  /** Test seam; production uses the real cached scheduler bridge. */
  getReadinessFn?: typeof getReadiness;
}): Promise<LaunchBranchResult | null> {
  const { task, parsed, effectivelyFreshStart, getProjectById } = args;
  const readiness = args.getReadinessFn ?? getReadiness;
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

  // Double-launch guard (server enforcement, mirrors the autonomous branch):
  // refuse a single-step launch while a live orchestrator is attached to this
  // campaign (a `loop_state.json` in_progress unit) — the manual runner would
  // race the autonomous loop. Closes the multi-tab / deploy-skew / direct-API
  // holes the client `attachedRun` flag cannot. Resume returned null above.
  if (readLoopAttachments(resolved.projectRoot, Date.now()).has(step.slug)) {
    return { error: { error: "campaign_run_already_attached", detail: step.slug }, status: 409 };
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

  // Scheduler readiness (DAG view, card trg-e542ce03): refuse a hand-launch of
  // a unit the monorepo scheduler reports BLOCKED. Bounded, and fail-OPEN when
  // no verdict can be had (timeout / engine down / unrecognised) — but loudly:
  // the response carries `readinessChecked:false`, never a silent skip. "No
  // loop running" is not a failure: there is nothing to check against.
  let readinessChecked: false | undefined;
  let verdict: Awaited<ReturnType<typeof readiness>>;
  try {
    verdict = await readiness(
      { projectRoot: resolved.projectRoot, slug: step.slug },
      undefined,
      { maxAgeMs: STEP_READINESS_MAX_AGE_MS, maxWaitMs: STEP_READINESS_MAX_WAIT_MS },
    );
  } catch {
    verdict = "timeout"; // a throwing check is "no verdict" — fail open, flagged
  }
  const freshVerdict = async () => {
    try {
      const v = await readiness(
        { projectRoot: resolved.projectRoot, slug: step.slug },
        undefined,
        { maxAgeMs: 0, maxWaitMs: STEP_READINESS_MAX_WAIT_MS },
      );
      return v === "timeout" ? undefined : v;
    } catch {
      return undefined;
    }
  };
  if (verdict === "timeout" || (verdict.status !== "report" && verdict.status !== "no-loop")) {
    readinessChecked = false;
  } else if (verdict.status === "report") {
    const units = verdict.report.units;
    const lower = step.stepId.toLowerCase();
    const unit = units.find((u) => u.id === step.stepId) ?? units.find((u) => u.id.toLowerCase() === lower);
    // Only a real DEPENDENCY gate (a blocker naming another unit) refuses. A
    // campaign-level gate (id:null — unsupported strategy, finalized loop) says
    // the batch scheduler cannot run this campaign, not that this step must not
    // be hand-run: launch, flagged unchecked.
    const dependencyBlocked = unit?.state === "pending" && !unit.ready && unit.blocked_by.some((x) => x.id !== null);
    if (!unit) {
      readinessChecked = false;
    } else if (dependencyBlocked) {
      // Never refuse on a cached "waiting": a dependency may have merged in
      // the last few seconds. Recompute once, uncached, before saying no.
      // Refuse ONLY on a fresh report that confirms the dependency blocker. No
      // fresh answer (timeout / down / unit gone) fails open like everywhere else.
      const fresh = await freshVerdict();
      if (fresh?.status === "report") {
        const freshUnit = fresh.report.units.find((u) => u.id === unit.id);
        if (!freshUnit) {
          readinessChecked = false;
        } else if (freshUnit.state === "pending" && !freshUnit.ready) {
          if (freshUnit.blocked_by.some((x) => x.id !== null)) {
            return { error: { error: "campaign_step_not_ready", detail: step.stepId, blocked_by: freshUnit.blocked_by }, status: 409 };
          }
          readinessChecked = false; // only a campaign-level gate remains
        }
      } else if (fresh?.status !== "no-loop") {
        readinessChecked = false;
      }
    } else if (unit.state === "pending" && !unit.ready) {
      readinessChecked = false; // campaign-level gate only
    }
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
  return readinessChecked === false ? { commands, taskUpdate, readinessChecked } : { commands, taskUpdate };
}
