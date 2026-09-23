/*
 * external/launch/runtime-chokepoint-errors.ts — the Codex-runtime error
 * bodies shared between `runtime-chokepoint.ts` and `external/tasks/
 * fork.ts` (fork cannot call the chokepoint per §2.1's correction, but the
 * user-facing wording has no reason to drift between the two call sites).
 *
 * Split out of runtime-chokepoint.ts (2026-09-23 — that file crossed the
 * 300-line guideline) so each file stays a single concern.
 */

import os from "node:os";

import { installHint } from "../../core/readiness-install-hints.js";

export function codextenderProxyUnreachableError(port: number) {
  return {
    error: "codextender_proxy_unreachable" as const,
    detail:
      `This task's runtime is Codex, and the Codex Integration Mode is ` +
      `Codextender, but the local Codextender proxy at ` +
      `127.0.0.1:${port} isn't reachable. Start the ` +
      "Codextender proxy, or switch this task's runtime to Claude.",
  };
}

/**
 * PR-review BLOCK (iterate-2026-09-23-codextender-webui-integration,
 * second round) — a hardcoded fallback bearer token read as an unsafe
 * unconditional credential. `resolveCodextenderAuthToken()` now has no
 * built-in default: a launch/fork attempted with none configured fails
 * loud here instead of silently sending nothing (which `claude` would
 * reject anyway once it tries to use `ANTHROPIC_BASE_URL`) or falling
 * back to a baked-in value.
 */
export function codextenderAuthTokenMissingError() {
  return {
    error: "codextender_auth_token_missing" as const,
    detail:
      "This task's runtime is Codex, and the Codex Integration Mode is " +
      "Codextender, but no CODEXTENDER_AUTH_TOKEN is set in the webui " +
      "server's environment. Set it to the local Codextender proxy's " +
      "configured master key (see the codextender README) and restart " +
      "the server, or switch this task's runtime to Claude.",
  };
}

export function codexCliNotFoundError() {
  return {
    error: "codex_cli_not_found" as const,
    detail:
      "This task's runtime is Codex, but the Codex CLI isn't installed " +
      "on this machine. " + installHint("codex", os.platform()) +
      ", or switch this task's runtime to Claude.",
  };
}

/**
 * Doubt-review HIGH (iterate-2026-09-23-codextender-webui-integration) —
 * see `CodextenderCwdMismatchError`'s own doc comment in
 * `core/launcher-codextender.ts` for why this can happen: a custom
 * action's commands are built from `project.path`, not `task.cwd`, and the
 * two can diverge for a worktree-based task.
 */
export function codextenderCwdMismatchError() {
  return {
    error: "codextender_cwd_mismatch" as const,
    detail:
      "This task's launch command was built from a different working " +
      "directory than the task's own cwd — refusing to launch with an " +
      "ambiguous working directory.",
  };
}
