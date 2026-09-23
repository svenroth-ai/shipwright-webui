/*
 * Codextender launch-command builder (Codextender integration spec Part B.2,
 * `C:\01_Development\shipwright\Spec\codextender-integration.md`).
 *
 * Sibling of `launcher-codex.ts`, but structurally different from it:
 * Codextender never changes the DRIVING BINARY (`claude` stays `claude` —
 * only `ANTHROPIC_BASE_URL`/`ANTHROPIC_MODEL` re-point it at a local
 * LiteLLM proxy that talks to a Codex-plan subscription). So instead of
 * re-implementing session/resume/name/plugin-dir argv logic the way
 * `launcher-codex.ts` does for the genuinely different `codex` CLI, this
 * module REUSES the already-built plain-Claude `CopyCommandForms` for this
 * task (identical to what an ordinary Claude-runtime launch would produce)
 * and prepends a per-shell env-var prefix ahead of the `claude` invocation
 * itself — the exact insertion point `buildCdPrefix` (pure, exported from
 * `launcher.ts`) lets us locate by exact string match, no regex guessing.
 *
 * "webui never spawns a process, only builds a string" (CLAUDE.md rule 1)
 * holds identically to every other launcher in this directory.
 */

import { buildCdPrefix, type CopyCommandForms } from "./launcher.js";
import { qPs, qCmd, qPosix } from "./shell-quote.js";

/**
 * Resolves the bearer token sent to the local Codextender proxy from
 * `process.env.CODEXTENDER_AUTH_TOKEN` — a validated configuration/
 * environment value, never a value baked into this source (PR-review
 * BLOCK, iterate-2026-09-23, second round: a hardcoded fallback here read
 * as an unconditional credential regardless of its actual local-only,
 * non-secret nature). Returns `undefined` when unset or blank; every
 * caller must treat that as "Codextender isn't configured on this machine"
 * and fail closed (`codextenderAuthTokenMissingError`) rather than send an
 * empty/placeholder token.
 */
export function resolveCodextenderAuthToken(): string | undefined {
  const fromEnv = process.env.CODEXTENDER_AUTH_TOKEN?.trim();
  return fromEnv && fromEnv.length > 0 ? fromEnv : undefined;
}

/** Matches `codextender`'s own CLI default (`codextender --port 4000`
 *  exposes `gpt-6-sol` as alias `sol` unless told otherwise). */
export const DEFAULT_CODEXTENDER_MODEL_ALIAS = "sol";

export interface CodextenderLaunchArgs {
  cwd: string;
  /** `http://127.0.0.1:<codextenderPort>` — built by the caller from the
   *  `codextenderPort` global setting. */
  baseUrl: string;
  /** The Codextender model alias (Part A — "no closed enum", free text,
   *  reuses the existing `codexImplementationModel` launch-body field).
   *  Defaults to `DEFAULT_CODEXTENDER_MODEL_ALIAS` when omitted. */
  model?: string;
  /**
   * Resolved via `resolveCodextenderAuthToken()` by the caller — this
   * function has no built-in default and never resolves it itself, so a
   * caller that skips the "is Codextender configured?" preflight gets a
   * TypeScript error here, not a silently-sent empty/placeholder token.
   */
  authToken: string;
  /**
   * The already-built plain-Claude commands for THIS task (same
   * session-id/resume/name/plugin-dir/slash-command shape an ordinary
   * Claude-runtime launch of this task would produce) — the chokepoint's
   * own Claude-fallback `commands`, computed before it decides to override
   * for a Codex-runtime task.
   */
  claudeCommands: CopyCommandForms;
}

/**
 * Doubt-review HIGH — `args.cwd` is caller-supplied (`task.cwd` at the
 * launch chokepoint and the fork route; `applyActionSubstitutionBranch`'s
 * custom-action commands are built from `project.path` instead, which can
 * legitimately diverge from `task.cwd`, e.g. a worktree-based task). When
 * `args.claudeCommands` was built from a DIFFERENT cwd than `args.cwd`,
 * the exact-string cd-prefix match below fails, and silently falling
 * through to prepend a second, possibly-wrong `cd`/`Set-Location` ahead of
 * the original produced a command that could abort outright (PowerShell's
 * `-ErrorAction Stop` on a nonexistent `args.cwd`) or silently launch in
 * the wrong directory. Thrown instead, so a caller surfaces this as an
 * actionable error rather than an auto-executed command that mysteriously
 * fails or does the wrong thing.
 */
export class CodextenderCwdMismatchError extends Error {
  constructor(cwd: string) {
    super(
      `buildCodextenderCommands: claudeCommands' embedded cd-prefix does not ` +
        `match args.cwd (${cwd}) — this task's plain-Claude commands appear ` +
        "to have been built from a different working directory.",
    );
    this.name = "CodextenderCwdMismatchError";
  }
}

export function buildCodextenderCommands(args: CodextenderLaunchArgs): CopyCommandForms {
  return {
    powershell: injectEnvPrefix(args, "powershell", qPs),
    cmd: injectEnvPrefix(args, "cmd", qCmd),
    posix: injectEnvPrefix(args, "posix", qPosix),
  };
}

function injectEnvPrefix(
  args: CodextenderLaunchArgs,
  shellForm: "powershell" | "cmd" | "posix",
  q: (v: string) => string,
): string {
  const cdPrefix = buildCdPrefix(shellForm, args.cwd);
  const full = args.claudeCommands[shellForm];
  if (!full.startsWith(cdPrefix)) {
    throw new CodextenderCwdMismatchError(args.cwd);
  }
  const rest = full.slice(cdPrefix.length);
  return cdPrefix + buildCodextenderEnvPrefix(args, q, shellForm) + rest;
}

/**
 * Same three per-shell quoting forms `launcher-codex.ts`'s own
 * `buildReviewEnvPrefix` uses (PowerShell `$env:X = ...;`, cmd
 * `set X=Y &&`, posix `X=Y `) — reused as a pattern, not imported (that
 * function is private to `launcher-codex.ts` and this module has no
 * dependency on Codex-CLI concerns).
 */
function buildCodextenderEnvPrefix(
  args: CodextenderLaunchArgs,
  q: (v: string) => string,
  shellForm: "powershell" | "cmd" | "posix",
): string {
  const model = args.model?.trim() || DEFAULT_CODEXTENDER_MODEL_ALIAS;
  const entries: Array<[string, string]> = [
    ["ANTHROPIC_BASE_URL", args.baseUrl],
    ["ANTHROPIC_AUTH_TOKEN", args.authToken],
    ["ANTHROPIC_MODEL", model],
    ["CODEXTENDER_ACTIVE", "1"],
    ["CODEXTENDER_MODEL", model],
  ];

  if (shellForm === "powershell") {
    return entries.map(([name, value]) => `$env:${name} = ${q(value)}; `).join("");
  }
  if (shellForm === "cmd") {
    return entries.map(([name, value]) => `set ${q(`${name}=${value}`)} && `).join("");
  }
  return entries.map(([name, value]) => `${name}=${q(value)} `).join("");
}
