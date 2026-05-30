/*
 * Action parameter schema (canonical definition).
 *
 * iterate/launch-cli-parameters § 1 — Schema-Modul Layout.
 *
 * Server is the canonical source for ParamSchema/ResolvedParam. The
 * client maintains a structural-subset RenderableParamSchema in
 * client/src/types/action-schema.ts; a sync test prevents drift
 * (client/src/test/action-schema-sync.test.ts).
 *
 * Cross-bundle imports (server -> client) are intentionally avoided:
 * webui has no monorepo root + no path aliasing between workspaces.
 *
 * Security boundary:
 *   The cli_flag allowlist regex is the actual injection guard for
 *   user-overridable .shipwright-webui/actions.json. Per-shell escaping in
 *   actions-substitute.ts is the second layer for user-supplied VALUES.
 */

/**
 * Allowlist regex for `cli_flag` and `cli_flag_map` values. Validated at
 * load time in `validateActionsSchema`. The `@` form is reserved for the
 * positional `@<file>` shipwright-build argument (value_separator: "none").
 *
 * Matches: --foo, --foo-bar, -x, @
 * Rejects: --foo=bar, "; rm -rf /", flags with whitespace, empty string.
 */
export const CLI_FLAG_PATTERN = /^(--?[a-z][a-z0-9-]*|@)$/;

/**
 * Allowlist regex for ParamSchema.name (used as object key in POST body).
 */
export const PARAM_NAME_PATTERN = /^[a-z][a-z0-9-]*$/;

export type ParamType = "boolean" | "enum" | "string";

export type ValueSeparator = "space" | "equals" | "none";

export interface ParamSchema {
  /** Internal key — kebab-case, matches PARAM_NAME_PATTERN. Eindeutig pro Schema-Block. */
  name: string;
  /** UI label shown in the modal. */
  label: string;
  /** Param type controls UI render and resolution rules. */
  type: ParamType;
  /**
   * Single CLI flag emitted when the value is truthy. Mutually exclusive
   * with `cli_flag_map`. Must match CLI_FLAG_PATTERN.
   */
  cli_flag?: string;
  /**
   * Per-enum-value flag map. Used when different enum values map to
   * different flags (e.g. deploy.target: prod -> "--prod"). Map values
   * must match CLI_FLAG_PATTERN; missing keys mean "skip emission" for
   * that enum value (no empty strings allowed).
   */
  cli_flag_map?: Record<string, string>;
  /** Allowed enum values (required when type === "enum"). */
  enum?: string[];
  /**
   * Default value. Server applies this during resolution when the POST
   * body is missing the key OR sends an empty/whitespace value.
   * Validated against type/pattern/enum at load time.
   */
  default?: string | boolean;
  /** UI placeholder for string inputs. */
  placeholder?: string;
  /** Optional helper text rendered under the field. */
  helpText?: string;
  /** How the value is joined to the flag. Default: "space". */
  value_separator?: ValueSeparator;
  /**
   * Regex string used to validate string values. Compiled defensively
   * with try/catch in the loader; malformed patterns reject at load time.
   */
  pattern?: string;
  /**
   * When true: client disables Copy until the value is set; server
   * returns 400 if missing/empty.
   */
  required?: boolean;
  /**
   * Sensitive value (token/password). UI renders password input; preview
   * shows fixed-length mask; server logs redact the value.
   */
  sensitive?: boolean;
}

export interface ResolvedParam {
  /** Guaranteed non-empty after resolution. Comes from cli_flag or cli_flag_map[value]. */
  cli_flag: string;
  /** Present for string/enum values; absent for boolean flags. */
  value?: string;
  /** How to join cli_flag and value when rendering. */
  separator: ValueSeparator;
  /** Marker forwarded to logging layers; substituter ignores. */
  sensitive?: boolean;
}
