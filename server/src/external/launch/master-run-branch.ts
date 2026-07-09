/*
 * external/launch/master-run-branch.ts — applyMasterRunBranch (campaign
 * webui-pipeline-convergence, sub-iterate W2).
 *
 * Branch in launch precedence (phaseTaskRef → campaign → campaignStep →
 * MASTER-RUN → action → legacy): `parsed.masterRun` present + fresh-start.
 * Builds the single-session master launch command ENTIRELY server-side:
 *
 *   claude --session-id <uuid> --add-dir <cwd> --name '<title>' '/shipwright-run'
 *
 * The `/shipwright-run` master then drives every phase via a phase-runner
 * subagent in ONE conversation (mode: single_session) — there is NO per-phase
 * Continue. This is a sibling of applyCampaignBranch (an autonomous-orchestrator
 * launch), NOT a per-phase pipeline continuation: it carries no phaseTaskId and
 * creates no phase shadow, so the `useContinuePipeline()` single-entry rule
 * (conventions rule 14) does not apply — the master IS the driver.
 *
 * The client only ever sends `{ masterRun: true }` — never the command
 * (Architecture rule 1 / regression guard #19; command built EXCLUSIVELY by
 * core/launcher.ts). The untrusted→trusted boundary is the run_config gate: the
 * project must have a readable v2 `run_config` whose resolved mode is
 * `single_session` (mirrors applyCampaignBranch requiring the campaign dir to
 * exist). WebUI only READS run_config here (CLAUDE.md rule 12 — never writes it).
 *
 * Returns `null` when there is no masterRun OR the launch is a genuine resume
 * (JSONL on disk) — a resume injects no slash command, so it falls through to
 * the legacy `--resume` branch unchanged (`claude --resume <masterUuid>`
 * rebuilds the master conversation, which re-enters the single-session loop).
 */

import { buildCopyCommands } from "../../core/launcher.js";
import { resolveRunMode } from "../../types/run-config-v2.js";
import type { RunConfigReadResult } from "../../core/run-config-reader.js";
import {
  type ExternalTask,
  type ExternalTaskState,
} from "../../core/sdk-sessions-store.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";
import type { ParsedLaunchBody } from "./parse-body.js";
import type { LaunchBranchResult } from "./_helpers.js";

export async function applyMasterRunBranch(args: {
  task: ExternalTask;
  parsed: ParsedLaunchBody;
  effectivelyFreshStart: boolean;
  getProjectById:
    | ((id: string) => ExternalRouteProjectView | undefined)
    | undefined;
  runConfigReader: (projectPath: string) => Promise<RunConfigReadResult>;
}): Promise<LaunchBranchResult | null> {
  const { task, parsed, effectivelyFreshStart, getProjectById, runConfigReader } =
    args;
  if (!parsed.masterRun) return null; // not a master-run launch
  // A resume injects no slash command — fall through to the legacy --resume
  // shape (`claude --resume <masterUuid>` re-enters the single-session loop).
  if (!effectivelyFreshStart) return null;

  // Defense-in-depth: the project must resolve AND carry a readable
  // single_session run_config. Never inject `/shipwright-run` for a run the
  // WebUI cannot vouch for.
  const project = getProjectById?.(task.projectId);
  if (!project) {
    return {
      error: {
        error: "master_launch_no_run_config",
        detail: "project not resolvable",
      },
      status: 400,
    };
  }
  const cfg = await runConfigReader(project.path);
  if (cfg.status !== "ok") {
    // missing / v1_legacy / invalid — nothing to launch a master for.
    return {
      error: { error: "master_launch_no_run_config", detail: cfg.status },
      status: 400,
    };
  }
  const mode = resolveRunMode(cfg.config);
  if (mode !== "single_session") {
    // multi_session (or a mode-less legacy config → multi_session) uses the
    // per-phase Continue path, not a single master. Refuse rather than inject
    // `/shipwright-run` into a multi-session run.
    return {
      error: { error: "master_launch_wrong_mode", detail: mode },
      status: 400,
    };
  }

  const commands = buildCopyCommands({
    sessionUuid: task.sessionUuid,
    cwd: task.cwd,
    pluginDirs: task.pluginDirs,
    title: task.title,
    slashCommand: "/shipwright-run",
  });
  const taskUpdate: Partial<ExternalTask> = {
    state: "awaiting_external_start" as ExternalTaskState,
    launchedAt: new Date().toISOString(),
  };
  return { commands, taskUpdate };
}
