/*
 * external/launch/action-substitution-branch.ts —
 * applyActionSubstitutionBranch.
 *
 * Branch 2 in launch precedence: actionId present + fresh-start +
 * project resolvable. Runs the action's `command_template` through
 * substitutePlaceholders for {powershell, cmd, posix}.
 *
 * Returns `null` when actionId is absent OR the project does not
 * resolve (caller falls through to legacy). Otherwise returns either
 * the substituted commands+taskUpdate, or an error envelope.
 */

import { type CopyCommandForms } from "../../core/launcher.js";
import {
  substitutePlaceholders,
  UnknownPhaseError,
  UnknownActionError,
  InvalidTitleError,
  InvalidParameterError,
  InvalidPlaceholderError,
  type SubstitutionContext,
} from "../../core/actions-substitute.js";
import { loadActionsForProject } from "../../core/project-actions-loader.js";
import { resolveParameters } from "../../core/parameter-resolver.js";
import {
  type ExternalTask,
  type ExternalTaskState,
} from "../../core/sdk-sessions-store.js";
import type { ExternalRouteProjectView } from "../_shared/helpers.js";
import type { ParsedLaunchBody } from "./parse-body.js";
import type { LaunchBranchResult } from "./_helpers.js";

export function applyActionSubstitutionBranch(args: {
  task: ExternalTask;
  parsed: ParsedLaunchBody;
  effectivelyFreshStart: boolean;
  getProjectById:
    | ((id: string) => ExternalRouteProjectView | undefined)
    | undefined;
}): LaunchBranchResult | null {
  const { task, parsed, effectivelyFreshStart, getProjectById } = args;
  if (!parsed.actionId || !effectivelyFreshStart) return null;

  const project = getProjectById?.(task.projectId);
  if (!project) return null; // fall back to legacy

  const loaded = loadActionsForProject(project.path || "");
  const action = loaded.actions.actions.find((a) => a.id === parsed.actionId);
  if (!action || !action.command_template) {
    return {
      error: { error: "unknown_action_id", actionId: parsed.actionId },
      status: 400,
    };
  }
  const allowedPhaseIds = new Set(loaded.actions.phases.map((p) => p.id));

  // Resolve user-supplied CLI parameters against the action's schema.
  const resolveResult = resolveParameters({
    action,
    phase: parsed.phase,
    userParams: parsed.userParams,
  });
  if (!resolveResult.ok) {
    return {
      error: {
        error: resolveResult.error,
        ...(resolveResult.name ? { name: resolveResult.name } : {}),
        ...(resolveResult.detail ? { detail: resolveResult.detail } : {}),
        ...(resolveResult.allowed ? { allowed: resolveResult.allowed } : {}),
      },
      status: 400,
    };
  }

  const ctx: SubstitutionContext = {
    project: { id: project.id, path: project.path || "" },
    task: {
      uuid: task.sessionUuid,
      title: task.title,
      description: parsed.description,
      phase: parsed.phase ?? "",
      phase_label: parsed.phaseLabel ?? "",
      autonomy: parsed.autonomy,
      parameters: resolveResult.resolved,
    },
    pluginDirs: task.pluginDirs,
    allowedPhaseIds,
    actionId: parsed.actionId,
    // iterate-2026-06-11-custom-action-slash-command — a custom action's
    // declared slash command, so {task.initial_prompt} fuses slash +
    // description into ONE positional. Undefined for builtin ids (ignored).
    slashCommand: action.slash_command,
  };
  let commands: CopyCommandForms;
  try {
    commands = {
      powershell: substitutePlaceholders(
        action.command_template,
        ctx,
        "powershell",
      ),
      cmd: substitutePlaceholders(action.command_template, ctx, "cmd"),
      posix: substitutePlaceholders(action.command_template, ctx, "posix"),
    };
  } catch (err) {
    if (
      err instanceof UnknownPhaseError ||
      err instanceof InvalidTitleError ||
      err instanceof InvalidParameterError ||
      err instanceof InvalidPlaceholderError ||
      // A custom action using {task.initial_prompt} without a valid
      // slash_command throws UnknownActionError. The GET /actions schema
      // validation rejects this at load time, but the launch route does not
      // re-run that gate — so convert to a typed 400 here rather than letting
      // it surface as an unhandled 500 (review follow-up).
      err instanceof UnknownActionError
    ) {
      return {
        error: {
          error: "command_substitution_failed",
          detail: err.message,
        },
        status: 400,
      };
    }
    throw err;
  }

  const taskUpdate: Partial<ExternalTask> = {
    state: "awaiting_external_start" as ExternalTaskState,
    launchedAt: new Date().toISOString(),
    actionId: parsed.actionId,
  };
  if (parsed.phase) taskUpdate.phase = parsed.phase;
  if (parsed.phaseLabel) taskUpdate.phaseLabel = parsed.phaseLabel;
  if (parsed.description) taskUpdate.description = parsed.description;
  if (parsed.autonomy) taskUpdate.autonomy = parsed.autonomy;
  return { commands, taskUpdate };
}
