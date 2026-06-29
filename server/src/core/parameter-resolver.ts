/*
 * Parameter resolution for POST /api/external/tasks/:id/launch.
 *
 * Plan: iterate/launch-cli-parameters § 3 + § 5.
 *
 * Pipeline:
 *   1. Schema lookup (action.parameters OR action.phase_parameters[phase]).
 *   2. Default-injection for absent / empty user values (server is Quelle der Wahrheit).
 *   3. Required-check.
 *   4. Per-type validation (boolean, enum, string with pattern + control-char reject).
 *   5. Build ResolvedParam[] in schema order.
 *
 * Returns either { ok: true, resolved } or { ok: false, error }.
 * The route handler maps `error` to a 400 JSON response.
 *
 * SECURITY:
 *   This is not the security boundary for cli_flag injection — that's
 *   `validateActionsSchema` (allowlist regex at load time). Resolver
 *   trusts schema.cli_flag came pre-validated.
 *
 *   For VALUE inputs, this resolver enforces: pattern, newline-reject,
 *   control-char-reject (incl. bidi-overrides), 16-KB length cap.
 */

import type { ActionDefinition } from "./project-actions-loader.js";
import type { ParamSchema, ResolvedParam } from "../types/action-schema.js";

export type ResolverErrorCode =
  | "phase_has_no_parameter_schema"
  | "unknown_parameter"
  | "required_parameter_missing"
  | "parameter_type_mismatch"
  | "parameter_enum_invalid"
  | "parameter_pattern_mismatch"
  | "parameter_invalid_character"
  | "parameter_value_too_long";

export interface ResolverError {
  ok: false;
  error: ResolverErrorCode;
  name?: string;
  detail?: string;
  allowed?: string[];
}

export interface ResolverSuccess {
  ok: true;
  resolved: ResolvedParam[];
}

export type ResolverResult = ResolverSuccess | ResolverError;

/** Max byte length for any single string parameter value. */
export const MAX_STRING_PARAM_BYTES = 16 * 1024;

/**
 * Bidi override + non-printable ASCII control character regex. Tab and LF
 * are excluded from this check because tabs are sometimes legal in paths
 * (rare but possible) and LF is rejected separately by the newline check
 * with a more specific error code.
 *
 * Range:
 *   \x00-\x08  → NUL, SOH ... BS
 *   \x0B-\x1F  → VT, FF, ... US (skips \x09 TAB, \x0A LF, but \x0D CR is in range)
 *   \x7F       → DEL
 *   U+202A..U+202E → LRE/RLE/PDF/LRO/RLO (bidi formatting)
 *   U+2066..U+2069 → LRI/RLI/FSI/PDI (bidi isolates)
 */
const CONTROL_CHAR_REGEX =
  // The bidi/control codepoints in the class below are the REJECTION set — this
  // regex IS the bidi-override injection DEFENSE (see range doc above), not a
  // trojan-source carrier. Semgrep false positive.
  // nosemgrep: generic.unicode.security.bidi.contains-bidirectional-characters
  /[\x00-\x08\x0B-\x1F\x7F‪-‮⁦-⁩]/;

/**
 * Resolve user-supplied parameter values against an ActionDefinition for a
 * specific phase (when the action uses `phase_parameters`).
 *
 * - `phase` may be empty/undefined for actions with `parameters` (not
 *   phase-bound).
 * - `userParams` is the raw POST body `parameters` field, validated as
 *   `Record<string, string | boolean>` by the route layer beforehand.
 */
export function resolveParameters(args: {
  action: ActionDefinition;
  phase: string | undefined;
  userParams: Record<string, string | boolean> | undefined;
}): ResolverResult {
  const { action, phase, userParams } = args;
  const params = userParams ?? {};

  // Schema lookup.
  let schema: ParamSchema[] | undefined;
  if (action.phase_parameters) {
    if (!phase) {
      // Phase missing, schema is phase-bound — if user supplied any
      // parameters, fail closed; otherwise nothing to resolve.
      if (Object.keys(params).length > 0) {
        return {
          ok: false,
          error: "phase_has_no_parameter_schema",
          detail: "phase_parameters requires a non-empty phase",
        };
      }
      return { ok: true, resolved: [] };
    }
    schema = action.phase_parameters[phase];
    if (!schema) {
      // Selected phase has no schema entry. Fail closed if the user sent
      // any parameters; otherwise treat as no-params.
      if (Object.keys(params).length > 0) {
        return {
          ok: false,
          error: "phase_has_no_parameter_schema",
          detail: `phase "${phase}" has no parameter schema in this action`,
          allowed: Object.keys(action.phase_parameters),
        };
      }
      return { ok: true, resolved: [] };
    }
  } else if (action.parameters) {
    schema = action.parameters;
  } else {
    // Action has no parameter schema at all.
    if (Object.keys(params).length > 0) {
      return {
        ok: false,
        error: "phase_has_no_parameter_schema",
        detail: "action has no parameter schema",
      };
    }
    return { ok: true, resolved: [] };
  }

  // Reject unknown keys before resolving.
  const knownNames = new Set(schema.map((s) => s.name));
  for (const key of Object.keys(params)) {
    if (!knownNames.has(key)) {
      return { ok: false, error: "unknown_parameter", name: key };
    }
  }

  const resolved: ResolvedParam[] = [];
  for (const s of schema) {
    const result = resolveOne(s, params[s.name]);
    if (!result.ok) return result;
    if (result.value !== undefined) resolved.push(result.value);
  }

  return { ok: true, resolved };
}

interface ResolveOneOk {
  ok: true;
  /** undefined → skip this parameter (no flag emitted). */
  value: ResolvedParam | undefined;
}

function resolveOne(
  schema: ParamSchema,
  rawValue: string | boolean | undefined,
): ResolveOneOk | ResolverError {
  // iterate/fix-adopt-prompt-shape § 4 — opt-in semantics for OPTIONAL
  // params: defaults are UI hints, NOT auto-applied. Only user-explicit
  // values are emitted. This fixes the v0.2.0 bug where defaults like
  // `crawl-max-depth: 3` were silently appended even when the user
  // wanted nothing.
  //
  // EXCEPTION (review-fix Gemini #2): for REQUIRED params with a
  // default, the server DOES fall back to the default — otherwise the
  // user would see the default in the placeholder, leave it untouched,
  // and get a 400 "required_parameter_missing". The fallback only fires
  // for `required: true` so optional defaults stay opt-in.
  let value: string | boolean | undefined = rawValue;
  if (
    schema.required &&
    schema.default !== undefined &&
    (value === undefined ||
      (typeof value === "string" && value.trim() === ""))
  ) {
    value = schema.default;
  }

  // Required-check (against value, which now includes the required+default fallback above).
  if (schema.required) {
    const empty =
      value === undefined ||
      value === false ||
      (typeof value === "string" && value.trim() === "");
    if (empty) {
      return {
        ok: false,
        error: "required_parameter_missing",
        name: schema.name,
      };
    }
  }

  // Boolean.
  if (schema.type === "boolean") {
    if (value === undefined || value === false) {
      return { ok: true, value: undefined };
    }
    if (value !== true) {
      return {
        ok: false,
        error: "parameter_type_mismatch",
        name: schema.name,
        detail: "expected boolean true/false",
      };
    }
    if (!schema.cli_flag) {
      // Schema validation guarantees this; defensive only.
      return {
        ok: false,
        error: "parameter_type_mismatch",
        name: schema.name,
        detail: "boolean parameter missing cli_flag",
      };
    }
    return {
      ok: true,
      value: { cli_flag: schema.cli_flag, separator: "none" },
    };
  }

  // Enum.
  if (schema.type === "enum") {
    if (value === undefined) return { ok: true, value: undefined };
    if (typeof value !== "string") {
      return {
        ok: false,
        error: "parameter_type_mismatch",
        name: schema.name,
        detail: "enum parameter must be a string",
      };
    }
    if (!schema.enum?.includes(value)) {
      return {
        ok: false,
        error: "parameter_enum_invalid",
        name: schema.name,
        allowed: schema.enum ?? [],
      };
    }
    let flag: string | undefined = schema.cli_flag;
    if (schema.cli_flag_map) {
      flag = schema.cli_flag_map[value];
    }
    if (!flag) {
      // skip emission (e.g. deploy.target=dev with no map entry).
      return { ok: true, value: undefined };
    }
    return {
      ok: true,
      value: {
        cli_flag: flag,
        value,
        separator: schema.value_separator ?? "space",
        sensitive: schema.sensitive,
      },
    };
  }

  // String.
  if (value === undefined) return { ok: true, value: undefined };
  if (typeof value !== "string") {
    return {
      ok: false,
      error: "parameter_type_mismatch",
      name: schema.name,
      detail: "string parameter must be a string",
    };
  }
  const trimmed = value.trim();
  if (trimmed === "") return { ok: true, value: undefined };

  // Length cap.
  if (Buffer.byteLength(trimmed, "utf-8") > MAX_STRING_PARAM_BYTES) {
    return {
      ok: false,
      error: "parameter_value_too_long",
      name: schema.name,
    };
  }

  // Newline reject (analog to task.description?).
  if (/[\r\n]/.test(trimmed)) {
    return {
      ok: false,
      error: "parameter_invalid_character",
      name: schema.name,
      detail: "newline characters are not allowed",
    };
  }

  // Control / bidi-override reject.
  if (CONTROL_CHAR_REGEX.test(trimmed)) {
    return {
      ok: false,
      error: "parameter_invalid_character",
      name: schema.name,
      detail: "control or bidi-override character",
    };
  }

  // Pattern check.
  if (schema.pattern) {
    let re: RegExp;
    try {
      // `schema.pattern` is a developer-authored action-schema pattern (trusted
      // config, rejected at load time if malformed), not user input. Semgrep FP.
      // nosemgrep: javascript.lang.security.audit.detect-non-literal-regexp.detect-non-literal-regexp
      re = new RegExp(schema.pattern);
    } catch {
      // Should be unreachable — validateActionsSchema rejects malformed
      // patterns at load time. Defensive fall-through.
      return {
        ok: false,
        error: "parameter_pattern_mismatch",
        name: schema.name,
        detail: "schema pattern compile failed",
      };
    }
    if (!re.test(trimmed)) {
      return {
        ok: false,
        error: "parameter_pattern_mismatch",
        name: schema.name,
      };
    }
  }

  if (!schema.cli_flag) {
    return {
      ok: false,
      error: "parameter_type_mismatch",
      name: schema.name,
      detail: "string parameter missing cli_flag",
    };
  }

  return {
    ok: true,
    value: {
      cli_flag: schema.cli_flag,
      value: trimmed,
      separator: schema.value_separator ?? "space",
      sensitive: schema.sensitive,
    },
  };
}
