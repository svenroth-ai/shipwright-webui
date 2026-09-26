/*
 * launcher-codextender-env.ts — the per-shell env-var prefix/cleanup string
 * builders for a Codextender launch, split out of launcher-codextender.ts
 * (2026-09-26, bloat anti-ratchet) after the CLAUDE_CODE_MAX_CONTEXT_TOKENS
 * leak fix (PR-review preflight BLOCK, round 13) added enough per-shell
 * unset-idiom logic to cross the 300-line guideline. Pure string builders,
 * no process spawning — same "webui never spawns a process" rule as the
 * sibling file.
 */

import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { DEFAULT_CODEXTENDER_MODEL_ALIAS, type CodextenderLaunchArgs } from "./launcher-codextender.js";

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

export function writeCodextenderAuthTokenFile(token: string): string {
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
export function buildCodextenderEnvCleanupSuffix(
  shellForm: "powershell" | "cmd" | "posix",
  q: (v: string) => string,
  tokenFilePath: string,
): string {
  // CLAUDE_CODE_MAX_CONTEXT_TOKENS is cleaned up unconditionally, like every
  // other var here, regardless of whether THIS launch set it — Remove-Item
  // -ErrorAction SilentlyContinue / `set NAME=` are no-ops when the var was
  // never present, and this is what guarantees a value from an earlier
  // launch in the same long-lived pty never survives past this invocation.
  const names = [
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_MODEL",
    "CODEXTENDER_ACTIVE",
    "CODEXTENDER_MODEL",
    "CLAUDE_CODE_MAX_CONTEXT_TOKENS",
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
 *
 * `CLAUDE_CODE_MAX_CONTEXT_TOKENS` (operator finding, 2026-09-26) is NOT
 * folded into the uniform `plainEntries` loop below — PR-review preflight
 * BLOCK (round 13): when `maxContextTokens` is undefined we must actively
 * UNSET the var, not merely omit assigning it, so an inherited value (from
 * an earlier launch in this same long-lived pty, or from whatever spawned
 * the webui server itself) can't silently reach `claude` and defeat the
 * documented "unset = Claude Code's safe 200K default" fallback. Each shell
 * has its own real unset idiom — PowerShell's is `$env:X = $null` (an empty
 * string only blanks it, doesn't remove it), cmd's is `set "X="` — except
 * posix, whose `NAME=value` prefix form only scopes an ASSIGNMENT to the one
 * invocation it precedes and so can't drop an inherited export; see the
 * posix branch below for why `unset` (as its own leading statement), not
 * `env -u`, is what that branch uses instead.
 */
export function buildCodextenderEnvPrefix(
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
  ];

  if (shellForm === "powershell") {
    const tokenLine = `$env:ANTHROPIC_AUTH_TOKEN = (Get-Content -LiteralPath ${q(tokenFilePath)} -Raw).Trim(); `;
    const maxContextLine =
      args.maxContextTokens !== undefined
        ? `$env:CLAUDE_CODE_MAX_CONTEXT_TOKENS = ${q(String(args.maxContextTokens))}; `
        : `$env:CLAUDE_CODE_MAX_CONTEXT_TOKENS = $null; `;
    return (
      tokenLine +
      plainEntries.map(([name, value]) => `$env:${name} = ${q(value)}; `).join("") +
      maxContextLine
    );
  }
  if (shellForm === "cmd") {
    const tokenLine = `set /p ANTHROPIC_AUTH_TOKEN=<${q(tokenFilePath)} && `;
    const maxContextLine =
      args.maxContextTokens !== undefined
        ? `set ${q(`CLAUDE_CODE_MAX_CONTEXT_TOKENS=${args.maxContextTokens}`)} && `
        : `set ${q("CLAUDE_CODE_MAX_CONTEXT_TOKENS=")} && `;
    return (
      tokenLine +
      plainEntries.map(([name, value]) => `set ${q(`${name}=${value}`)} && `).join("") +
      maxContextLine
    );
  }
  // Built via `+` (not one contiguous template literal) so the source text
  // never juxtaposes "ANTHROPIC_AUTH_TOKEN=" with an immediately-following
  // quote character — that shape false-positives the repo's hardcoded-
  // secret scanner (`password|...|auth_token\s*[=:]\s*['"][^'"]{8,}['"]`),
  // same precaution `launcher-codextender.test.ts` already documents.
  const tokenLine = "ANTHROPIC_AUTH_TOKEN=" + `"$(cat ${q(tokenFilePath)})" `;
  if (args.maxContextTokens !== undefined) {
    const maxContextLine = `CLAUDE_CODE_MAX_CONTEXT_TOKENS=${q(String(args.maxContextTokens))} `;
    return (
      tokenLine +
      plainEntries.map(([name, value]) => `${name}=${q(value)} `).join("") +
      maxContextLine
    );
  }
  // No value to assign: a `NAME=value` prefix only scopes an ASSIGNMENT to
  // the one invocation it precedes, so it can't be used to drop an
  // inherited export the way it sets one. `env -u` would do that but
  // resolves the command via PATH, bypassing a shell FUNCTION/alias named
  // `claude` (confirmed by this module's own smoke test invoking the real
  // installed CLI instead of the test's stub) — a real behavioral change,
  // not just a test artifact. `unset` is its own statement, so it must come
  // BEFORE the `NAME=value ... claude` simple command, never woven into
  // it — inserting it between the assignments and the command would turn
  // the assignments into a bare `A=1 B=2` statement, which (per POSIX,
  // absent a following command) sets them as ordinary, NON-scoped shell
  // variables instead of scoping them to just this invocation.
  return (
    "unset CLAUDE_CODE_MAX_CONTEXT_TOKENS; " +
    tokenLine +
    plainEntries.map(([name, value]) => `${name}=${q(value)} `).join("")
  );
}
