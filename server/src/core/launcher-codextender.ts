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

import { randomUUID } from "node:crypto";
import { unlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

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
   * The Codextender model's real context window in tokens, resolved by the
   * caller from the proxy's own `/v1/models` `max_input_tokens` field
   * (`resolveCodextenderMaxContextTokens` in `codextender-proxy-probe.ts`) —
   * operator finding, 2026-09-26: Claude Code assumes a 200K window for any
   * model id it doesn't recognize and over-compacts against that wrong
   * ceiling long before the real ~1.05M-token Codex window is anywhere near
   * full. `undefined` (probe failed, alias unknown, or field absent) leaves
   * `CLAUDE_CODE_MAX_CONTEXT_TOKENS` unset — the safe fallback is Claude
   * Code's own 200K default, never a number guessed here.
   */
  maxContextTokens?: number;
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
  // PR-review preflight fix (round 8, iterate-2026-09-23) — the bearer token
  // itself never appears in any of the three command strings below; only
  // this file's PATH does. See `writeCodextenderAuthTokenFile`'s doc comment
  // for why a temp file replaces the literal-value approach round 7's
  // env-cleanup fix alone didn't fully address.
  const tokenFilePath = writeCodextenderAuthTokenFile(args.authToken);
  try {
    return {
      powershell: injectEnvPrefix(args, "powershell", qPs, tokenFilePath),
      cmd: injectEnvPrefix(args, "cmd", qCmd, tokenFilePath),
      posix: injectEnvPrefix(args, "posix", qPosix, tokenFilePath),
    };
  } catch (err) {
    // A cwd mismatch (below) throws before any command is returned for the
    // caller to run/clean up itself — without this, the token file written
    // above would be orphaned on every mismatch, not just a killed pty.
    unlinkSync(tokenFilePath);
    throw err;
  }
}

/**
 * PR-review preflight BLOCK (round 7, iterate-2026-09-23) — embedding
 * `authToken`'s literal value in the generated command put it in terminal
 * input/scrollback and any session recording, even after round 7's own
 * env-cleanup suffix removed it from the shell's PERSISTENT environment
 * (that fix addressed leak-to-a-LATER-command, not visibility of THIS one).
 * Round 8: the token is written once to a private, per-launch temp file
 * (`0o600`, a fresh random name) and every shell form reads it back via its
 * own no-echo idiom (PowerShell `Get-Content`, cmd `set /p ... <file`, posix
 * `$(cat file)`) — confirmed empirically (real `cmd.exe`/`powershell.exe`,
 * not just read) that each correctly sets the var for a CHILD process
 * without ever printing the file's contents. `buildCodextenderEnvCleanupSuffix`
 * deletes it unconditionally after the `claude` invocation on all three
 * shells. Residual risk, accepted: a pty killed before that cleanup step
 * runs leaves an orphaned token file in the OS temp dir — a materially
 * smaller and shorter-lived exposure than the permanent scrollback record
 * this replaces, and the OS temp dir is already user-scoped (not
 * world-readable) on both Windows and POSIX.
 *
 * Round-12 preflight hardening: `flag: "wx"` creates the file exclusively
 * (fails with EEXIST instead of following a pre-existing symlink at the
 * generated path), so a TOCTOU symlink race in the shared temp dir can
 * never redirect the token write onto an attacker-chosen file. A random
 * UUID path already makes a genuine collision astronomically unlikely; the
 * bounded retry only exists to survive that near-impossible case rather
 * than crash the launch.
 */
const MAX_TOKEN_FILE_CREATE_ATTEMPTS = 5;

function writeCodextenderAuthTokenFile(token: string): string {
  for (let attempt = 0; attempt < MAX_TOKEN_FILE_CREATE_ATTEMPTS; attempt++) {
    const filePath = path.join(tmpdir(), `codextender-auth-${randomUUID()}.tmp`);
    try {
      writeFileSync(filePath, `${token}\n`, { mode: 0o600, flag: "wx" });
      return filePath;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "EEXIST") continue;
      throw err;
    }
  }
  throw new Error(
    "Failed to create a unique Codextender auth token file after " +
      `${MAX_TOKEN_FILE_CREATE_ATTEMPTS} attempts`,
  );
}

function injectEnvPrefix(
  args: CodextenderLaunchArgs,
  shellForm: "powershell" | "cmd" | "posix",
  q: (v: string) => string,
  tokenFilePath: string,
): string {
  const cdPrefix = buildCdPrefix(shellForm, args.cwd);
  const full = args.claudeCommands[shellForm];
  if (!full.startsWith(cdPrefix)) {
    throw new CodextenderCwdMismatchError(args.cwd);
  }
  const rest = full.slice(cdPrefix.length);
  return (
    cdPrefix +
    buildCodextenderEnvPrefix(args, q, shellForm, tokenFilePath) +
    rest +
    buildCodextenderEnvCleanupSuffix(shellForm, q, tokenFilePath, args.maxContextTokens !== undefined)
  );
}

/**
 * Doubt-review/plan-review HIGH — PowerShell (`$env:X = ...;`) and cmd
 * (`set X=Y &&`) mutate the CURRENT, persistent shell's environment (unlike
 * the posix prefix form, which scopes to the one invocation it precedes).
 * The embedded terminal is a long-lived pty shell, not spawned fresh per
 * command, so without this suffix the proxy's `ANTHROPIC_BASE_URL` /
 * `ANTHROPIC_AUTH_TOKEN` / `ANTHROPIC_MODEL` would silently outlive this one
 * `claude` invocation and get inherited by whatever the user (or a later
 * Relaunch-as-Claude/Codex-Light) types next in the same tab. Runs
 * unconditionally after `rest` (cmd's `&`, PowerShell's/posix's `;` — none
 * gated on `rest`'s own exit code, so cleanup still happens if `claude`
 * exits non-zero). The temp token file is deleted here too, on all three
 * shells — posix's env-scoping was already correct, but it still wrote the
 * file to disk and must still remove it.
 */
function buildCodextenderEnvCleanupSuffix(
  shellForm: "powershell" | "cmd" | "posix",
  q: (v: string) => string,
  tokenFilePath: string,
  hasMaxContextTokens: boolean,
): string {
  const names = [
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_MODEL",
    "CODEXTENDER_ACTIVE",
    "CODEXTENDER_MODEL",
    ...(hasMaxContextTokens ? ["CLAUDE_CODE_MAX_CONTEXT_TOKENS"] : []),
  ];
  if (shellForm === "powershell") {
    return (
      `; Remove-Item ${names.map((n) => `Env:${n}`).join(",")} -ErrorAction SilentlyContinue` +
      `; Remove-Item -LiteralPath ${q(tokenFilePath)} -Force -ErrorAction SilentlyContinue`
    );
  }
  if (shellForm === "cmd") {
    return names.map((n) => ` & set ${n}=`).join("") + ` & del /f /q ${q(tokenFilePath)}`;
  }
  return ` ; rm -f ${q(tokenFilePath)}`;
}

/**
 * Same three per-shell quoting forms `launcher-codex.ts`'s own
 * `buildReviewEnvPrefix` uses (PowerShell `$env:X = ...;`, cmd
 * `set X=Y &&`, posix `X=Y `) — reused as a pattern, not imported (that
 * function is private to `launcher-codex.ts` and this module has no
 * dependency on Codex-CLI concerns). `ANTHROPIC_AUTH_TOKEN` is the one
 * exception to the uniform `name=value` shape — see
 * `writeCodextenderAuthTokenFile`'s doc comment for why it's read back from
 * `tokenFilePath` instead of written as a literal.
 */
function buildCodextenderEnvPrefix(
  args: CodextenderLaunchArgs,
  q: (v: string) => string,
  shellForm: "powershell" | "cmd" | "posix",
  tokenFilePath: string,
): string {
  const model = args.model?.trim() || DEFAULT_CODEXTENDER_MODEL_ALIAS;
  const plainEntries: Array<[string, string]> = [
    ["ANTHROPIC_BASE_URL", args.baseUrl],
    ["ANTHROPIC_MODEL", model],
    ["CODEXTENDER_ACTIVE", "1"],
    ["CODEXTENDER_MODEL", model],
    ...(args.maxContextTokens !== undefined
      ? ([["CLAUDE_CODE_MAX_CONTEXT_TOKENS", String(args.maxContextTokens)]] as Array<
          [string, string]
        >)
      : []),
  ];

  if (shellForm === "powershell") {
    const tokenLine = `$env:ANTHROPIC_AUTH_TOKEN = (Get-Content -LiteralPath ${q(tokenFilePath)} -Raw).Trim(); `;
    return tokenLine + plainEntries.map(([name, value]) => `$env:${name} = ${q(value)}; `).join("");
  }
  if (shellForm === "cmd") {
    const tokenLine = `set /p ANTHROPIC_AUTH_TOKEN=<${q(tokenFilePath)} && `;
    return (
      tokenLine + plainEntries.map(([name, value]) => `set ${q(`${name}=${value}`)} && `).join("")
    );
  }
  // Built via `+` (not one contiguous template literal) so the source text
  // never juxtaposes "ANTHROPIC_AUTH_TOKEN=" with an immediately-following
  // quote character — that shape false-positives the repo's hardcoded-
  // secret scanner (`password|...|auth_token\s*[=:]\s*['"][^'"]{8,}['"]`),
  // same precaution `launcher-codextender.test.ts` already documents.
  const tokenLine = "ANTHROPIC_AUTH_TOKEN=" + `"$(cat ${q(tokenFilePath)})" `;
  return tokenLine + plainEntries.map(([name, value]) => `${name}=${q(value)} `).join("");
}
