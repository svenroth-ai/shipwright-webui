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
 *
 * Double-master guard (W3, mirrors applyCampaignBranch's
 * `campaign_run_already_attached`): a fresh master launch is refused with 409
 * `master_run_already_attached` when ANOTHER master shadow is already attached to
 * the same run. Two `/shipwright-run` masters driving one run_config would race
 * phase_task claims. Client idempotency (reuse the master shadow) covers the
 * single-tab path; this closes the multi-tab / direct-API hole it cannot.
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

/** A master shadow is "attached" when it is LAUNCHED and NOT terminal — i.e. one
 *  of the four in-progress states. This is defined by STATE alone (NOT
 *  `firstJsonlObservedAt`): a terminal `done` master necessarily carries a
 *  historical `firstJsonlObservedAt`, and counting that as "attached" would block
 *  a fresh launch for a completed run forever. `draft` (never launched),
 *  `launch_failed` (dead), and `done` (terminal) therefore do NOT block; the
 *  two-tab race is still caught because a racing master sits in
 *  `awaiting_external_start` the instant it launches. */
const ATTACHED_MASTER_STATES: ReadonlySet<ExternalTaskState> = new Set([
  "awaiting_external_start",
  "active",
  "idle",
  "jsonl_missing",
]);

function isAttachedMaster(t: ExternalTask): boolean {
  return ATTACHED_MASTER_STATES.has(t.state);
}

export async function applyMasterRunBranch(args: {
  task: ExternalTask;
  parsed: ParsedLaunchBody;
  effectivelyFreshStart: boolean;
  getProjectById:
    | ((id: string) => ExternalRouteProjectView | undefined)
    | undefined;
  runConfigReader: (projectPath: string) => Promise<RunConfigReadResult>;
  /** Snapshot of all tasks — the double-master guard scans it for another
   *  attached master of the same run. Optional so direct callers without a
   *  store can opt out; the route always wires it. */
  listTasks?: () => ExternalTask[];
  /** D18/F14 — ground-truth JSONL probe (`SessionWatcher.findByUuid !== null`).
   *  The persisted `firstJsonlObservedAt` lags Claude's first write by 5-15 s,
   *  and the master CTA sends `resume:false` during that window; a fresh
   *  `--session-id` re-launch is then REJECTED by Claude ("Session ID already
   *  in use"). Trust the disk. Optional so direct callers without a watcher opt
   *  out (absent → treated as "no JSONL"); the route wires it from the watcher. */
  jsonlExistsOnDisk?: (sessionUuid: string) => Promise<boolean>;
}): Promise<LaunchBranchResult | null> {
  const {
    task,
    parsed,
    effectivelyFreshStart,
    getProjectById,
    runConfigReader,
    listTasks,
    jsonlExistsOnDisk,
  } = args;
  if (!parsed.masterRun) return null; // not a master-run launch

  // D18/F14 — the master's `<uuid>.jsonl` already exists → this is a genuine
  // resume regardless of the (possibly stale) client `resume` flag. Re-enter
  // the master conversation with `--resume <masterUuid>` (no slash command);
  // re-injecting `--session-id '/shipwright-run'` would make Claude reject the
  // duplicate session id. Only walk the disk when the persisted stamp is absent
  // (short-circuit). This function stays PURE — it returns a `taskUpdate` and
  // the route persists it; it never writes the store itself.
  const discovered =
    !task.firstJsonlObservedAt &&
    Boolean(await jsonlExistsOnDisk?.(task.sessionUuid));
  const established = Boolean(task.firstJsonlObservedAt) || discovered;
  if (established) {
    const commands = buildCopyCommands({
      sessionUuid: task.sessionUuid,
      cwd: task.cwd,
      resume: true,
      pluginDirs: task.pluginDirs,
      title: task.title,
    });
    return {
      commands,
      taskUpdate: {
        state: "awaiting_external_start" as ExternalTaskState,
        launchedAt: new Date().toISOString(),
        // Spec: stamp on discovery so the board CTA + the next launch reflect the
        // established master immediately. Conditional (only when the stamp was
        // absent) so a concurrent re-launch just re-writes the same field — the
        // background transcript poll records the same stamp independently.
        ...(discovered
          ? { firstJsonlObservedAt: new Date().toISOString() }
          : {}),
      },
    };
  }

  // Not established. A resume request with no JSONL yet (or a dryRun) falls
  // through to the legacy branch exactly as before — the fresh `/shipwright-run`
  // path below is gated on `effectivelyFreshStart`.
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

  // Double-master guard: refuse a second master while another shadow is already
  // attached to this run. Only OTHER shadows count (`taskId !== task.taskId`);
  // the launching task is the client-reused master in the normal path. Resume
  // returned null above, so this only gates a genuine fresh launch. Scoped to the
  // SAME project (`projectId`) so a duplicated project dir — which copies the
  // `runId` verbatim into its `shipwright_run_config.json` — can't cross-block;
  // mirrors applyCampaignBranch's project-scoped `campaign_run_already_attached`.
  const attached = (listTasks?.() ?? []).find(
    (t) =>
      t.taskId !== task.taskId &&
      t.parentRunMaster === true &&
      t.projectId === task.projectId &&
      t.runId === cfg.config.runId &&
      isAttachedMaster(t),
  );
  if (attached) {
    return {
      error: { error: "master_run_already_attached", detail: attached.taskId },
      status: 409,
    };
  }

  const commands = buildCopyCommands({
    sessionUuid: task.sessionUuid,
    cwd: task.cwd,
    pluginDirs: task.pluginDirs,
    title: task.title,
    slashCommand: "/shipwright-run",
  });
  // Stamp the run identity on the launched task (F34). Without this, a
  // direct-API `{ masterRun: true }` launch on a PLAIN task (created without
  // parentRunMaster/runId) would attach a master the double-master guard scan
  // (`parentRunMaster === true && runId === cfg.runId`) cannot see — the exact
  // hole this guard exists to close. `runId` comes from the re-read run_config
  // above (WebUI never trusts a client-supplied runId; CLAUDE.md rule 12).
  const taskUpdate: Partial<ExternalTask> = {
    state: "awaiting_external_start" as ExternalTaskState,
    launchedAt: new Date().toISOString(),
    parentRunMaster: true,
    runId: cfg.config.runId,
  };
  return { commands, taskUpdate };
}
