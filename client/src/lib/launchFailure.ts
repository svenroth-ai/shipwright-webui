/*
 * launchFailure.ts — the SINGLE source of failure words + recovery actions for
 * the campaign / task launch state machine (FR-01.61, A17).
 *
 * Today a failed launch looks identical to the board a second earlier. This
 * module maps every terminal launch signal — a server error `code`, a
 * `task.state`, a `useContinuePipeline()` reason, or a resume-recovery — onto
 * `{ title, sentence, actions }`. EVERY surface (campaign card, task card,
 * task-detail header) renders from this ONE map so three surfaces can never
 * describe the same failure three different ways (AC4).
 *
 * Recovery honesty (AC3): a Retry action appears ONLY where a retry can
 * actually succeed. A `403`/`422` names the fix instead of offering a Retry
 * that cannot help. It carries NO command literal — the retry re-enters
 * `useContinuePipeline()` (rule 14), which asks the SERVER for the command
 * (rule 1). No slash-command / phase string lives here (DO-NOT #11).
 */

import type { ExternalTaskState } from "./externalApi";

/** A recovery affordance a surface may render. The surface wires the callback;
 *  this module only declares which affordances are honest for a given failure. */
export type LaunchFailureAction =
  | "retry"
  | "copy-command"
  | "open-terminal"
  | "resume"
  | "open-project-settings"
  | "refresh";

export interface LaunchFailure {
  /** Machine reason: server error code, task state, or hook reason. */
  code: string;
  tone: "error" | "recovery";
  title: string;
  sentence: string;
  actions: LaunchFailureAction[];
  /** The surface should render the associated path (campaign dir / watched path). */
  showPath?: boolean;
}

export type LaunchFailureInput =
  | { source: "task"; state: ExternalTaskState }
  | { source: "server"; code: string }
  | { source: "pipeline"; reason: string }
  | { source: "resume-recovery" };

const LAUNCH_FAILED: LaunchFailure = {
  code: "launch_failed",
  tone: "error",
  title: "Launch failed",
  sentence:
    "The launch never produced a running session — it failed before, or as, the terminal ran the command.",
  actions: ["retry", "copy-command", "open-terminal"],
};

const JSONL_MISSING: LaunchFailure = {
  code: "jsonl_missing",
  tone: "error",
  title: "No transcript appeared",
  sentence:
    "The launch ran but no transcript ever appeared at the watched path. Either the command never actually ran in the terminal, or Claude suppressed the flat transcript for a child session (a CLAUDE_CODE_CHILD_SESSION=1 leak into the pty env).",
  actions: ["open-terminal", "resume"],
  showPath: true,
};

const RESUME_RECOVERY: LaunchFailure = {
  code: "resume_recovery",
  tone: "recovery",
  title: "Session can be resumed",
  sentence:
    "The transcript is on disk but no live terminal is attached — the session was interrupted (a restart, a killed terminal, or the machine slept). Resume reattaches it.",
  actions: ["resume"],
};

/** Server error codes → notice. Retry only where a retry can succeed (AC3). */
const SERVER_CODES: Record<string, LaunchFailure> = {
  path_traversal_rejected: {
    code: "path_traversal_rejected",
    tone: "error",
    title: "Blocked for safety",
    sentence:
      "The campaign folder resolved outside the project root, so the Command Center refused to write there. Clicking again cannot help — this path is unsafe.",
    actions: [],
    showPath: true,
  },
  no_writable_status_target: {
    code: "no_writable_status_target",
    tone: "error",
    title: "Nowhere to record the change",
    sentence:
      "This campaign has neither a status.json nor a campaign.md frontmatter block to record 'active' into. Clicking again will not help — add one of those to the campaign folder first.",
    actions: [],
    showPath: true,
  },
  lock_unavailable: {
    code: "lock_unavailable",
    tone: "error",
    title: "Campaign storage is busy",
    sentence:
      "Another writer holds the campaign lock right now. This is genuinely temporary — retry in a moment.",
    actions: ["retry"],
  },
  campaign_not_found: {
    code: "campaign_not_found",
    tone: "error",
    title: "Campaign not found",
    sentence:
      "This campaign's folder moved or was removed since the board last loaded. Check the project's path in settings.",
    actions: ["open-project-settings"],
  },
  project_path_invalid: {
    code: "project_path_invalid",
    tone: "error",
    title: "Project path is stale",
    sentence:
      "The project's folder path is stale or missing, so the campaign could not be reached. Fix it in project settings.",
    actions: ["open-project-settings"],
  },
  project_not_found: {
    code: "project_not_found",
    tone: "error",
    title: "Project not found",
    sentence:
      "This project is no longer registered. Re-add it, or fix its path in project settings.",
    actions: ["open-project-settings"],
  },
  campaign_already_complete: {
    code: "campaign_already_complete",
    tone: "error",
    title: "Already complete",
    sentence:
      "This campaign already finished — the card you clicked is stale. Refresh to catch up with its real state.",
    actions: ["refresh"],
  },
  phase_task_session_uuid_mismatch: {
    code: "phase_task_session_uuid_mismatch",
    tone: "error",
    title: "Pipeline moved on",
    sentence:
      "The pipeline's pre-bound session no longer matches what this card was showing (the run-config advanced). Refresh and try again.",
    actions: ["refresh"],
  },
  mixed_launch_intents: {
    code: "mixed_launch_intents",
    tone: "error",
    title: "Conflicting launch request",
    sentence:
      "This launch asked for two different things at once and the server refused it. Refresh the board and try the launch again.",
    actions: ["refresh"],
  },
  permission_denied_path: {
    code: "permission_denied_path",
    tone: "error",
    title: "Permission denied",
    sentence:
      "The Command Center cannot write to this path (permission denied). Fix the folder's permissions, then try again.",
    actions: [],
    showPath: true,
  },
};

/** useContinuePipeline() reasons → notice (rule 14 — the funnel's own vocabulary). */
const PIPELINE_REASONS: Record<string, LaunchFailure> = {
  no_run_config: {
    code: "no_run_config",
    tone: "error",
    title: "No pipeline run",
    sentence: "No run-config could be read for this project, so there is nothing to continue yet.",
    actions: ["refresh"],
  },
  phase_task_not_found: {
    code: "phase_task_not_found",
    tone: "error",
    title: "Step not found",
    sentence: "This pipeline step is no longer in the run-config — the pipeline may have moved on.",
    actions: ["refresh"],
  },
  phase_task_not_actionable: {
    code: "phase_task_not_actionable",
    tone: "error",
    title: "Not ready to launch",
    sentence: "This pipeline step is not awaiting a launch right now.",
    actions: ["refresh"],
  },
  phase_task_prereq_not_met: {
    code: "phase_task_prereq_not_met",
    tone: "error",
    title: "Blocked by an earlier step",
    sentence: "An earlier pipeline step must finish before this one can launch.",
    actions: ["refresh"],
  },
  launch_failed: LAUNCH_FAILED,
};

/**
 * The exact JSONL path a jsonl_missing task's transcript was watched at, for the
 * failure notice (AC3). Discovery is filename-first (CLAUDE.md rule 3), so the
 * load-bearing part is `<uuid>.jsonl`; the directory is Claude's own encoding of
 * the cwd, shown as a placeholder rather than a possibly-wrong guess.
 */
export function watchedJsonlPath(sessionUuid: string): string {
  return `~/.claude/projects/<encoded-cwd>/${sessionUuid}.jsonl`;
}

/** Normalize an EACCES/EPERM filesystem error onto the permission-denied notice. */
function normalizeServerCode(code: string): string {
  if (/EACCES|EPERM/i.test(code)) return "permission_denied_path";
  return code;
}

/**
 * Parse the server error code out of a thrown launch error message. `httpJson`
 * throws `Error("HTTP <status> <url>: <body>")` where the body is the route's
 * JSON — so the real code is recoverable even though the structured ApiError is
 * not used on this path. Returns null when no `{"error":"…"}` is present.
 */
export function parseServerErrorCode(message: string | undefined | null): string | null {
  if (!message) return null;
  const m = /"error"\s*:\s*"([^"]+)"/.exec(message);
  if (m) return m[1];
  if (/EACCES|EPERM/i.test(message)) return "permission_denied_path";
  return null;
}

/**
 * Map a campaign launch `{ reason, detail }` result onto a failure descriptor.
 * `useLaunchCampaign{,Step}` surface `reason: "create_failed" | "launch_failed"`
 * with the raw thrown message in `detail`; the real server code (403 / 409 /
 * phase_task_session_uuid_mismatch / …) is buried in that message, so parse it
 * first and only fall back to the reason's family when there is none. Always
 * returns a descriptor (never null).
 */
export function launchResultFailure(reason: string, detail?: string): LaunchFailure {
  const code = parseServerErrorCode(detail);
  if (code) return resolveLaunchFailure({ source: "server", code })!;
  return resolveLaunchFailure({ source: "pipeline", reason })!;
}

/** Resolve the single failure descriptor for a launch signal, or null when the
 *  signal is not a failure (a live/idle task with no interruption). */
export function resolveLaunchFailure(input: LaunchFailureInput): LaunchFailure | null {
  switch (input.source) {
    case "task":
      if (input.state === "launch_failed") return LAUNCH_FAILED;
      if (input.state === "jsonl_missing") return JSONL_MISSING;
      return null;
    case "resume-recovery":
      return RESUME_RECOVERY;
    case "pipeline":
      return PIPELINE_REASONS[input.reason] ?? { ...LAUNCH_FAILED, code: input.reason };
    case "server": {
      const code = normalizeServerCode(input.code);
      return SERVER_CODES[code] ?? { ...LAUNCH_FAILED, code };
    }
  }
}
