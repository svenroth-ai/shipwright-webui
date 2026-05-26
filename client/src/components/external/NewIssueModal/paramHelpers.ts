/*
 * Pure helpers for the schema-driven parameter UI.
 *
 * Extracted from the pre-split NewIssueModal.tsx (lines 1426-1516). No
 * React imports — these are used by both the submit hook and the bodies
 * to compute the live preview + the launch-body `parameters` field.
 *
 * iterate/v030-five-ux-fixes (P1):
 *   - Boolean params: forwarded when `value === true`.
 *   - String/enum params: forwarded only when `enabled === true` AND the
 *     trimmed value is non-empty. Disabled or empty = skip emission. This
 *     mirrors the server-side resolver's "empty value = skip" semantic
 *     (parameter-resolver.ts:272-273).
 */

import type { PreviewParam } from "../CommandPreviewPanel";
import type { RenderableParamSchema } from "../../../types/action-schema";

/**
 * Map (schema, values, enabled) → PreviewParam[] for the live
 * CommandPreviewPanel.
 *
 * Mirrors the server's resolveParameters logic but is simpler — the
 * preview is approximate (server is authoritative on the actual command).
 */
export function paramsToPreview(
  schema: RenderableParamSchema[],
  values: Record<string, string | boolean>,
  enabled: Record<string, boolean>,
): PreviewParam[] {
  const out: PreviewParam[] = [];
  for (const s of schema) {
    const v: string | boolean | undefined = values[s.name];
    if (s.type === "boolean") {
      if (v !== true || !s.cli_flag) continue;
      out.push({ cli_flag: s.cli_flag, separator: "none" });
      continue;
    }
    // String / enum: optional fields require enabled=true. Required
    // fields are always treated as enabled (the modal seeds them on
    // open). The check works for both because required fields receive
    // `paramEnabled[name] = true` from the reset effect.
    if (!s.required && enabled[s.name] !== true) continue;
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (trimmed === "") continue;
    let flag: string | undefined = s.cli_flag;
    if (s.type === "enum" && s.cli_flag_map) {
      flag = s.cli_flag_map[trimmed];
    }
    if (!flag) continue;
    out.push({
      cli_flag: flag,
      value: trimmed,
      separator: s.value_separator ?? "space",
      sensitive: s.sensitive,
    });
  }
  return out;
}

/**
 * Drop schema entries that the user did NOT explicitly enable.
 *
 * Forwarding rules:
 *   - Boolean: forward `true`; drop everything else.
 *   - String/Enum: forward only when enabled === true AND value is a
 *     non-empty trimmed string. Disabled or empty → drop (skip-emit).
 */
export function explicitParamEntries(
  schema: RenderableParamSchema[],
  values: Record<string, string | boolean>,
  enabled: Record<string, boolean>,
): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (const p of schema) {
    const v = values[p.name];
    if (p.type === "boolean") {
      if (v === true) out[p.name] = true;
      continue;
    }
    // Required fields are always considered enabled (forced-on by the
    // modal's reset effect); the explicit-enabled flag is also seeded
    // true for them so this check is a no-op there.
    if (enabled[p.name] !== true) continue;
    if (typeof v !== "string") continue;
    const trimmed = v.trim();
    if (trimmed === "") continue;
    out[p.name] = trimmed;
  }
  return out;
}
