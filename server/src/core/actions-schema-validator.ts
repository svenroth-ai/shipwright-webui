/*
 * Actions.json structural validator.
 *
 * Iterate 3 section 03 — plan.md § 7 O24. The loader is pure I/O; this
 * validator catches the five schema failure modes that the external
 * review flagged:
 *   1. Duplicate action ids
 *   2. Invalid defaults.autonomy enum
 *   3. Empty phases[]
 *   4. Missing required action fields (command_template on external_launch)
 *   5. Unsupported modal_fields entry (stale `complexity:radio:...` per AD-03.13)
 *
 * Placeholder-level validation (unknown placeholder tokens inside
 * command_template) is the responsibility of
 * `actions-substitute.validateTemplate`. This module deliberately stays
 * structure-only so the two concerns compose.
 *
 * Returns a list of errors rather than throwing — the route layer
 * decides how to surface them (HTTP 400 with structured code on the
 * first error, or aggregated diagnostics for the GET /actions route).
 */

import type { ActionDefinition, ResolvedActions } from "./project-actions-loader.js";
import type { ParamSchema, ParamType } from "../types/action-schema.js";
import { CLI_FLAG_PATTERN, PARAM_NAME_PATTERN } from "../types/action-schema.js";
import {
  BUILTIN_INITIAL_PROMPT_ACTIONS,
  SLASH_COMMAND_PATTERN,
} from "./actions-substitute.js";

export type SchemaErrorCode =
  | "duplicate_action_id"
  | "invalid_autonomy_enum"
  | "empty_phases"
  | "missing_command_template"
  | "unsupported_modal_field"
  | "invalid_preview_enabled"
  | "invalid_param_type"
  | "invalid_param_enum"
  | "duplicate_param_name"
  | "invalid_cli_flag"
  | "invalid_cli_flag_map"
  | "invalid_param_pattern"
  | "invalid_default_value"
  | "invalid_param_name"
  | "missing_parameters_placeholder"
  | "orphan_parameters_placeholder"
  | "unknown_phase_parameter_key"
  | "invalid_param_required"
  | "invalid_phase_supports_autonomy"
  | "missing_slash_command"
  | "invalid_slash_command";

export interface SchemaError {
  code: SchemaErrorCode;
  [key: string]: unknown;
}

const VALID_PARAM_TYPES = new Set<ParamType>(["boolean", "enum", "string"]);
const PARAMETERS_PLACEHOLDER = "{task.parameters?}";
/**
 * iterate/fix-adopt-prompt-shape § 1 — actions can satisfy the
 * "schema → template references parameters" check by EITHER using the
 * legacy `{task.parameters?}` placeholder OR the new
 * `{task.initial_prompt}` placeholder (which embeds parameters into
 * the quoted initial-prompt string).
 */
const INITIAL_PROMPT_PLACEHOLDER = "{task.initial_prompt}";

// iterate-2026-06-11-custom-action-slash-command — whitespace-tolerant match
// for `{task.initial_prompt}`. The substituter trims placeholder keys, so
// `{ task.initial_prompt }` expands too; section 8 must detect the spaced form
// or the missing-slash case re-surfaces as a 500 (a literal includes() misses it).
const INITIAL_PROMPT_PLACEHOLDER_RE = /\{\s*task\.initial_prompt\s*\}/;

/**
 * Modal field allowlist (per AD-03.13). `complexity:radio:small,medium,large`
 * is explicitly removed; the new iterate modal uses complexity auto-detect
 * at skill-invocation time, not a pre-launch field.
 *
 * iterate-2026-05-14 lead-foundation-task-schema: 5 leadwright-routing
 * names added (`domain`, `priority`, `complexityHint`, `tags`,
 * `blockedBy`). They follow the same bare-name rule — anything with a
 * `:type:` suffix (e.g. `complexity:radio:...`) is still rejected.
 */
const SUPPORTED_MODAL_FIELDS = new Set([
  "title",
  "phase",
  "description",
  "autonomy",
  "project", // read-only strip or dropdown — not user-input but may appear in modal_fields for the `all projects` branch
  // lead-foundation-task-schema (iterate-2026-05-14, leadwright Phase 1)
  "domain",
  "priority",
  "complexityHint",
  "tags",
  "blockedBy",
]);

const VALID_AUTONOMY = new Set(["guided", "autonomous"]);

export function validateActionsSchema(
  actions: ResolvedActions,
): SchemaError[] {
  const errors: SchemaError[] = [];

  // 1. Duplicate action ids.
  const ids = new Set<string>();
  for (const a of actions.actions) {
    if (ids.has(a.id)) {
      errors.push({ code: "duplicate_action_id", id: a.id });
    }
    ids.add(a.id);
  }

  // 2. Invalid defaults.autonomy enum.
  if (!VALID_AUTONOMY.has(actions.defaults.autonomy)) {
    errors.push({
      code: "invalid_autonomy_enum",
      value: actions.defaults.autonomy,
    });
  }

  // 3. Empty phases[].
  if (!Array.isArray(actions.phases) || actions.phases.length === 0) {
    errors.push({ code: "empty_phases" });
  }

  // 4. Missing command_template on external_launch kind.
  for (const a of actions.actions) {
    if (a.kind === "external_launch") {
      if (typeof a.command_template !== "string" || a.command_template.trim() === "") {
        errors.push({ code: "missing_command_template", actionId: a.id });
      }
    }
  }

  // 5. Unsupported modal_fields entries.
  for (const a of actions.actions) {
    if (!a.modal_fields) continue;
    for (const field of a.modal_fields) {
      // Field may include a type suffix like `complexity:radio:...`; treat
      // anything with a colon as type-tagged and lookup by the bare name.
      const bare = field.split(":")[0];
      if (!SUPPORTED_MODAL_FIELDS.has(bare) || field !== bare) {
        // `field !== bare` catches `complexity:radio:...` even if `complexity`
        // alone were somehow in the allowlist (it isn't, but defense-in-depth).
        errors.push({
          code: "unsupported_modal_field",
          actionId: a.id,
          field,
        });
      }
    }
  }

  // preview.enabled type guard (not in the review list, but a JSON-
  // coerced junk value here would silently break the route's
  // precedence chain).
  const previewEnabled = actions.preview?.enabled;
  if (
    previewEnabled !== true &&
    previewEnabled !== false &&
    previewEnabled !== "auto"
  ) {
    errors.push({
      code: "invalid_preview_enabled",
      value: previewEnabled as unknown,
    });
  }

  // 6. Parameters / phase_parameters validation per action.
  const phaseIds = new Set(actions.phases.map((p) => p.id));
  for (const action of actions.actions) {
    validateActionParameters(action, phaseIds, errors);
  }

  // 7. Phase.supports_autonomy type-guard (iterate/v030-five-ux-fixes P3).
  for (const phase of actions.phases) {
    const v = (phase as { supports_autonomy?: unknown }).supports_autonomy;
    if (v !== undefined && typeof v !== "boolean") {
      errors.push({
        code: "invalid_phase_supports_autonomy",
        phaseId: phase.id,
        value: v,
      });
    }
  }

  // 8. slash_command for custom {task.initial_prompt} actions
  //    (iterate-2026-06-11-custom-action-slash-command). A NON-builtin action
  //    that fuses the prompt via {task.initial_prompt} MUST declare a well-formed
  //    slash_command — else buildSlashCommand returns null → UnknownActionError
  //    (400 launch / 500 dry-run). Fail loud at load instead. Builtins are exempt
  //    (hardcoded slash); actions on {task.description?} don't need it.
  for (const action of actions.actions) {
    const usesInitialPrompt =
      INITIAL_PROMPT_PLACEHOLDER_RE.test(action.command_template ?? "");
    if (!usesInitialPrompt) continue;
    if (BUILTIN_INITIAL_PROMPT_ACTIONS.has(action.id)) continue;
    // Trim so a whitespace-only value is "missing" and a padded-but-valid one
    // (" /x ") is accepted, consistent with buildSlashCommand.
    const slash =
      typeof action.slash_command === "string"
        ? action.slash_command.trim()
        : "";
    if (slash === "") {
      errors.push({ code: "missing_slash_command", actionId: action.id });
    } else if (!SLASH_COMMAND_PATTERN.test(slash)) {
      errors.push({
        code: "invalid_slash_command",
        actionId: action.id,
        slash_command: action.slash_command,
      });
    }
  }

  return errors;
}

/**
 * Validate `parameters` and `phase_parameters` for a single action.
 * Pushes any errors into the shared `errors` list.
 *
 * Checks performed (matching plan § 6):
 *  - Each ParamSchema is structurally well-formed.
 *  - cli_flag / cli_flag_map values pass the CLI_FLAG_PATTERN allowlist.
 *  - cli_flag_map values are non-empty (skip-emission == omission).
 *  - cli_flag_map keys are subset of the enum (when both present).
 *  - default values match type/pattern/enum.
 *  - String pattern compiles as a valid regex.
 *  - Names are unique within the same schema block.
 *  - phase_parameters keys exist in actions.phases[].id.
 *  - command_template contains {task.parameters?} when params are defined.
 *  - Inverse warning when template has the placeholder but no params defined.
 */
function validateActionParameters(
  action: ActionDefinition,
  phaseIds: Set<string>,
  errors: SchemaError[],
): void {
  const hasParams = !!action.parameters && action.parameters.length > 0;
  const hasPhaseParams =
    !!action.phase_parameters &&
    Object.values(action.phase_parameters).some((arr) => arr.length > 0);
  const hasParamsPlaceholder =
    action.command_template?.includes(PARAMETERS_PLACEHOLDER) ?? false;
  const hasInitialPromptPlaceholder =
    action.command_template?.includes(INITIAL_PROMPT_PLACEHOLDER) ?? false;
  const hasAnyPlaceholder = hasParamsPlaceholder || hasInitialPromptPlaceholder;

  // Template-Konsistenz: parameters defined but neither placeholder → fail.
  // Either {task.parameters?} (legacy) or {task.initial_prompt} (new in
  // iterate/fix-adopt-prompt-shape) satisfies the requirement.
  if ((hasParams || hasPhaseParams) && !hasAnyPlaceholder) {
    errors.push({
      code: "missing_parameters_placeholder",
      actionId: action.id,
    });
  }

  // Inverse warning: a parameter-bearing placeholder is present but no
  // parameters/phase_params defined. Only fires for the legacy
  // {task.parameters?} (which would be a no-op); {task.initial_prompt}
  // is meaningful even without parameters (it still emits the slash
  // command itself).
  if (!hasParams && !hasPhaseParams && hasParamsPlaceholder) {
    errors.push({
      code: "orphan_parameters_placeholder",
      actionId: action.id,
      severity: "warning",
    });
  }

  if (action.parameters) {
    validateParamArray(action.id, "parameters", action.parameters, errors);
  }

  if (action.phase_parameters) {
    for (const [phaseKey, params] of Object.entries(action.phase_parameters)) {
      if (!phaseIds.has(phaseKey)) {
        errors.push({
          code: "unknown_phase_parameter_key",
          actionId: action.id,
          phaseKey,
        });
      }
      validateParamArray(
        action.id,
        `phase_parameters.${phaseKey}`,
        params,
        errors,
      );
    }
  }
}

function validateParamArray(
  actionId: string,
  blockLabel: string,
  params: ParamSchema[],
  errors: SchemaError[],
): void {
  const seenNames = new Set<string>();

  for (const param of params) {
    // Name pattern.
    if (!PARAM_NAME_PATTERN.test(param.name)) {
      errors.push({
        code: "invalid_param_name",
        actionId,
        block: blockLabel,
        name: param.name,
      });
    }

    // Duplicate name within the same block.
    if (seenNames.has(param.name)) {
      errors.push({
        code: "duplicate_param_name",
        actionId,
        block: blockLabel,
        name: param.name,
      });
    }
    seenNames.add(param.name);

    // Type allowlist.
    if (!VALID_PARAM_TYPES.has(param.type)) {
      errors.push({
        code: "invalid_param_type",
        actionId,
        name: param.name,
        type: param.type,
      });
    }

    // Enum required and non-empty when type === "enum".
    if (param.type === "enum") {
      if (!Array.isArray(param.enum) || param.enum.length === 0) {
        errors.push({
          code: "invalid_param_enum",
          actionId,
          name: param.name,
        });
      }
    }

    // cli_flag pattern.
    if (param.cli_flag !== undefined) {
      if (!CLI_FLAG_PATTERN.test(param.cli_flag)) {
        errors.push({
          code: "invalid_cli_flag",
          actionId,
          name: param.name,
          cli_flag: param.cli_flag,
        });
      }
    }

    // cli_flag_map values pattern + no empties + keys subset of enum.
    if (param.cli_flag_map) {
      const enumSet = new Set(param.enum ?? []);
      for (const [key, flag] of Object.entries(param.cli_flag_map)) {
        if (flag === "" || !CLI_FLAG_PATTERN.test(flag)) {
          errors.push({
            code: "invalid_cli_flag",
            actionId,
            name: param.name,
            cli_flag_map_key: key,
            cli_flag: flag,
          });
        }
        if (param.enum && !enumSet.has(key)) {
          errors.push({
            code: "invalid_cli_flag_map",
            actionId,
            name: param.name,
            cli_flag_map_key: key,
          });
        }
      }
    }

    // Pattern defensive compile.
    if (param.pattern !== undefined) {
      try {
        // Defensive compile-check of a developer-authored action-schema pattern
        // (trusted config, not user input) — no ReDoS-from-untrusted-input vector.
        // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
        new RegExp(param.pattern);
      } catch (err) {
        errors.push({
          code: "invalid_param_pattern",
          actionId,
          name: param.name,
          pattern: param.pattern,
          detail: String(err).slice(0, 200),
        });
      }
    }

    // Default value validation.
    if (param.default !== undefined) {
      if (!isDefaultValid(param)) {
        errors.push({
          code: "invalid_default_value",
          actionId,
          name: param.name,
          default: param.default,
        });
      }
    }

    // iterate/fix-adopt-prompt-shape — boolean params with default:true
    // are unrepresentable under opt-in semantics: an unchecked checkbox
    // means "no flag emitted", so the default-true becomes effectively
    // unreachable. Reject at load time so users don't author broken
    // schemas. Required-boolean-default-true is rejected separately
    // below (the only escape is required+default fallback for STRINGS).
    if (param.type === "boolean" && param.default === true) {
      errors.push({
        code: "invalid_default_value",
        actionId,
        name: param.name,
        default: param.default,
        reason: "boolean default:true is unrepresentable under opt-in semantics",
      });
    }

    // iterate/v030-five-ux-fixes (P6) — boolean + required is also
    // unrepresentable under opt-in. The enable-checkbox IS the value for
    // booleans, so a "required" boolean would either need to be forced-on
    // (= effectively default:true, already rejected) or allow the user to
    // submit unchecked (= unsatisfied required gate). Either way, the
    // schema models a state that opt-in semantics can't reach. Hard-reject
    // at load time so misauthored configs fail loudly instead of silently
    // breaking the submit-gate at runtime.
    if (param.type === "boolean" && param.required === true) {
      errors.push({
        code: "invalid_param_required",
        actionId,
        name: param.name,
        reason: "boolean + required is unrepresentable under opt-in semantics",
      });
    }
  }
}

function isDefaultValid(param: ParamSchema): boolean {
  const def = param.default;

  if (param.type === "boolean") {
    return typeof def === "boolean";
  }

  if (typeof def !== "string") return false;

  if (param.type === "enum") {
    return Array.isArray(param.enum) && param.enum.includes(def);
  }

  // type === "string"
  if (param.pattern) {
    try {
      // `param.pattern` is a developer-authored action-schema pattern (trusted
      // config, validated at load time), not user input. Semgrep false positive.
      // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
      const re = new RegExp(param.pattern);
      if (!re.test(def)) return false;
    } catch {
      // Pattern invalid; default validity is unreachable — flagged via
      // invalid_param_pattern separately.
      return false;
    }
  }
  return true;
}
