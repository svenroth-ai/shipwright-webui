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
import { claimExecutorLaunchOverrides } from "./claim-executor-permissions.js";
import {
  armActionTemplatePermissionPerimeter,
  templateDeclaresSessionIdAnchor,
} from "./claim-executor-template-arming.js";

export function applyActionSubstitutionBranch(args: {
  task: ExternalTask;
  parsed: ParsedLaunchBody;
  effectivelyFreshStart: boolean;
  getProjectById:
    | ((id: string) => ExternalRouteProjectView | undefined)
    | undefined;
  /**
   * FR-04.22 (iterate-2026-09-06-claim-launch-permission-perimeter) — see
   * `legacy-fallback-branch.ts`'s own doc comment for the field's meaning.
   * THIS branch, not the legacy fallback, is the one leadwright's real
   * tasks actually reach (Stage-1 spec review, see
   * `claim-executor-template-arming.ts`'s header) — leadwright always sets
   * `actionId` at task creation (a required field on its side), and
   * `parse-body.ts`'s once-set-always-used contract resolves `parsed.actionId`
   * from that persisted value even though the launch body itself carries
   * only `{ claimToken }`.
   */
  claimAuthorized?: boolean;
}): LaunchBranchResult | null {
  const { task, parsed, effectivelyFreshStart, getProjectById, claimAuthorized } = args;
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

  if (claimAuthorized) {
    // Stage-3 doubt review: a rendered-output anchor search alone can be
    // fooled by a caller-supplied placeholder (e.g. {task.description?},
    // settable in this very request) that coincidentally contains this
    // task's own uuid formatted like the anchor. Requiring the literal
    // placeholder in the RAW template first closes that hole — the
    // template is project configuration, never launch-body content.
    if (!templateDeclaresSessionIdAnchor(action.command_template)) {
      return {
        error: {
          error: "claim_launch_permission_perimeter_unavailable",
          detail: `action "${action.id}"'s command_template does not declare a literal '--session-id {task.uuid}' placeholder — cannot arm the permission perimeter`,
        },
        status: 409,
      };
    }
    const armed = armActionTemplatePermissionPerimeter(
      commands,
      task.sessionUuid,
      claimExecutorLaunchOverrides(),
    );
    // Fail closed (this branch's own doc comment): a custom project
    // command_template not shaped like the bundled defaults must refuse
    // the launch rather than hand back an unrestricted command that looks
    // armed because the caller asked for arming.
    if (!armed.ok) {
      return {
        error: {
          error: "claim_launch_permission_perimeter_unavailable",
          detail: armed.detail,
        },
        status: 409,
      };
    }
    commands = armed.commands;
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
