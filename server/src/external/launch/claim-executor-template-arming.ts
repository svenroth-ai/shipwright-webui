/*
 * external/launch/claim-executor-template-arming.ts — FR-04.22 permission
 * perimeter for the ACTION-TEMPLATE launch path (iterate-2026-09-06-claim-
 * launch-permission-perimeter, Stage-1 review follow-up).
 *
 * `action-substitution-branch.ts` builds its command via
 * `substitutePlaceholders(action.command_template, ...)` — a completely
 * separate rendering path from `core/launcher.ts`'s `buildCopyCommands`/
 * `LaunchArgs`, so `launcher-permission-flags.ts`'s argv-level flags never
 * reach it. Spec review (Stage 1) proved this branch, not the legacy
 * fallback, is the one leadwright's real tasks actually hit: leadwright's
 * `CreateExternalTaskBody.actionId` is a REQUIRED field
 * (`webui-client.ts`), persisted onto the task
 * (`external/tasks/create.ts`), and `parse-body.ts`'s once-set-always-used
 * contract means a claim-only `{ claimToken }` launch body still resolves
 * `parsed.actionId` from that persisted value — so
 * `applyActionSubstitutionBranch` fires, not the legacy fallback.
 *
 * `command_template` is a project-configurable string (bundled defaults in
 * `config/default-actions.json`, or a project's own `actions.json` via
 * `loadActionsForProject`) — NOT a fixed shape this module can trust
 * blindly. Every bundled template starts `--session-id {task.uuid} ...`,
 * but a custom project template is not guaranteed to. FAIL CLOSED: if the
 * expected `--session-id <this task's own uuid>` anchor is not found,
 * verbatim, in a rendered shell form, this module refuses to arm rather
 * than silently returning an unrestricted command that LOOKS armed because
 * the caller asked for arming (the exact "looks compliant, isn't" failure
 * mode this whole card exists to close).
 *
 * Stage-3 doubt review found the rendered-output anchor search alone is not
 * enough: a template that never emits the literal `--session-id {task.uuid}`
 * placeholder at all could still coincidentally contain a UNIQUE occurrence
 * of `--session-id <this task's uuid>` inside a substituted, caller-supplied
 * placeholder (e.g. `{task.description?}`, settable in the very same
 * claim-authorized launch body) — arming would then splice the flags inside
 * quoted user text, not a real CLI flag, and still report success. Callers
 * MUST call `templateDeclaresSessionIdAnchor` on the RAW (pre-substitution)
 * `command_template` first and refuse to arm if it returns false — that
 * check is immune to request-supplied content because the template comes
 * from project configuration, not the launch body.
 *
 * The doubt review also found a template can independently re-declare
 * `--tools`/`--permission-mode` via its own `{task.parameters?}` (a
 * project's custom parameter schema may set `cli_flag: "--tools"` — the
 * allowlist regex in `types/action-schema.ts` permits it), which could
 * override or conflict with the injected flags depending on Claude CLI's
 * duplicate-flag precedence. This module therefore also fails closed if the
 * rendered command already contains either flag BEFORE arming.
 */

import { qPs, qCmd, qPosix, type CopyCommandForms } from "../../core/launcher.js";
import type { ClaimExecutorLaunchOverrides } from "./claim-executor-permissions.js";

export type ArmTemplateResult =
  | { ok: true; commands: CopyCommandForms }
  | { ok: false; detail: string };

const FLAG_QUOTERS: Record<keyof CopyCommandForms, (v: string) => string> = {
  powershell: qPs,
  cmd: qCmd,
  posix: qPosix,
};

/**
 * True only when the RAW `command_template` (before any substitution)
 * literally declares the `--session-id {task.uuid}` placeholder. This is
 * the attacker-uncontrollable precondition for arming: `command_template`
 * comes from project configuration (bundled defaults or a project's own
 * `.shipwright-webui/actions.json`), never from the launch request body, so
 * a caller cannot forge this check the way they could forge a coincidental
 * match in the RENDERED output (see module header).
 */
export function templateDeclaresSessionIdAnchor(commandTemplate: string): boolean {
  return commandTemplate.includes("--session-id {task.uuid}");
}

const CONFLICTING_FLAG_PATTERN = /(^|\s)(--tools|--permission-mode)(\s|$)/;

/**
 * Inserts `--tools <allow-list> --permission-mode <mode>` immediately after
 * the substituted `--session-id <this task's sessionUuid>` token, on all
 * three shell forms. The anchor is the task's own UUID rendered UNQUOTED —
 * verified live (`actions-substitute.ts`'s `{task.uuid}` case returns the
 * raw value, and its per-shell `q()` wrapping is applied only to
 * user-derived placeholders, not this one; a debug probe against the real
 * substitution engine confirmed `--session-id 11111111-...` with no quotes
 * on posix, cmd AND powershell). The flags THEMSELVES still go through the
 * matching shell's own quoter (`FLAG_QUOTERS`) — only the anchor is
 * unquoted, matching the substitution engine's own convention for a
 * server-generated UUID. The flags are inserted at the anchor's FIRST
 * occurrence only when that occurrence is provably unique in the rendered
 * string (checked via `indexOf` === `lastIndexOf`) — a custom project
 * `command_template` can interpolate other placeholders (e.g.
 * `{task.description}`) ahead of `{task.uuid}`, and a caller-supplied value
 * that happens to contain this task's own UUID would otherwise let the
 * flags land inside unrelated text while the real `--session-id` flag stays
 * unarmed and the function still reported success. A non-unique anchor
 * fails closed exactly like a missing one.
 */
export function armActionTemplatePermissionPerimeter(
  commands: CopyCommandForms,
  sessionUuid: string,
  overrides: ClaimExecutorLaunchOverrides,
): ArmTemplateResult {
  const armed: Partial<CopyCommandForms> = {};
  for (const shellForm of Object.keys(FLAG_QUOTERS) as Array<keyof CopyCommandForms>) {
    const q = FLAG_QUOTERS[shellForm];
    const marker = `--session-id ${sessionUuid}`;
    const source = commands[shellForm];
    const idx = source.indexOf(marker);
    if (idx === -1) {
      return {
        ok: false,
        detail: `no '--session-id ${sessionUuid}' anchor found in the ${shellForm} command form — cannot arm the permission perimeter`,
      };
    }
    if (idx !== source.lastIndexOf(marker)) {
      return {
        ok: false,
        detail: `'--session-id ${sessionUuid}' anchor is not unique in the ${shellForm} command form — cannot safely arm the permission perimeter`,
      };
    }
    if (CONFLICTING_FLAG_PATTERN.test(source)) {
      return {
        ok: false,
        detail: `the ${shellForm} command form already contains a --tools or --permission-mode flag before arming — refusing to risk a duplicate/conflicting flag`,
      };
    }
    const insertAt = idx + marker.length;
    const flags = ` --tools ${q(overrides.toolsAllowlist.join(","))} --permission-mode ${q(overrides.permissionMode)}`;
    armed[shellForm] = source.slice(0, insertAt) + flags + source.slice(insertAt);
  }
  return { ok: true, commands: armed as CopyCommandForms };
}
