/*
 * Renderable subset of the server's ParamSchema. The client only needs
 * the fields it consumes for UI rendering — server-side concerns
 * (cli_flag, cli_flag_map, value_separator) stay on the server. The sync
 * test (`client/src/test/action-schema-sync.test.ts`) verifies that
 * every field declared here also exists in the server canonical type.
 *
 * Plan: iterate/launch-cli-parameters § 1 — Schema-Modul Layout.
 */

export type ParamType = "boolean" | "enum" | "string";
export type ValueSeparator = "space" | "equals" | "none";

export interface RenderableParamSchema {
  /** Internal key — kebab-case, server enforces /^[a-z][a-z0-9-]*$/. */
  name: string;
  /** UI label shown in the modal. */
  label: string;
  /** Param type controls UI render. */
  type: ParamType;
  /** Allowed enum values (present when type === "enum"). */
  enum?: string[];
  /** Default value the modal pre-populates. Server applies if missing in POST. */
  default?: string | boolean;
  /** Placeholder for string inputs. */
  placeholder?: string;
  /** Optional helper text rendered under the field. */
  helpText?: string;
  /** When true: Copy disabled until value is set. */
  required?: boolean;
  /** Sensitive value — render password input + masked preview. */
  sensitive?: boolean;
  /** Pattern (only for messaging hints — final validation is server-side). */
  pattern?: string;
  /**
   * iterate/preview-params-render — needed for the live CommandPreviewPanel.
   * The server still owns the security (cli_flag allowlist, escaping); the
   * client uses these only to render the preview. Drift is caught by the
   * server-side sync test.
   */
  cli_flag?: string;
  cli_flag_map?: Record<string, string>;
  value_separator?: ValueSeparator;
}
