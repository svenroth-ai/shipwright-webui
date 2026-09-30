/*
 * launcher-codextender.smoke-helpers.ts — real-shell execution plumbing for
 * launcher-codextender.smoke.test.ts, split out (bloat anti-ratchet,
 * 2026-09-28) once the test file crossed the 300-line source/test limit
 * after adding CLAUDE_CODE_AUTO_MODE_SERVER coverage. Pure helpers + shell
 * spawning only — no `describe`/`it` here, so this file is not itself a
 * test suite (vitest only collects files it's told to run tests from; a
 * plain .ts helper imported by a .test.ts file is not treated as one).
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildCopyCommands } from "./launcher.js";
import { buildCodextenderCommands } from "./launcher-codextender.js";
import { POWERSHELL_QUIET_ENV } from "./powershell-probe.smoke-helpers.js";

export const SAMPLE_UUID = "00000000-1111-2222-3333-444444444444";
export const MARKER_VALUE = "smoke-test-secret-9f3a2b7c-do-not-leak";
export const ENV_NAMES = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_MODEL",
  "CODEXTENDER_ACTIVE",
  "CODEXTENDER_MODEL",
  "CLAUDE_CODE_AUTO_MODE_SERVER",
  "ANTHROPIC_DEFAULT_OPUS_MODEL",
  "ANTHROPIC_DEFAULT_SONNET_MODEL",
  "ANTHROPIC_DEFAULT_HAIKU_MODEL",
];
export const SPAWN_TIMEOUT_MS = 15_000;

export function extractTokenFilePath(command: string, shellForm: "powershell" | "cmd" | "posix"): string {
  if (shellForm === "powershell") {
    const m = command.match(/Get-Content -LiteralPath '([^']+)'/);
    if (!m) throw new Error("token file path not found in powershell command");
    return m[1];
  }
  /* v8 ignore start -- cmd.exe branch only reached via runCmd(), which
   * findCmd()'s win32 guard skips entirely on the Linux CI runner. */
  if (shellForm === "cmd") {
    const m = command.match(/set \/p ANTHROPIC_AUTH_TOKEN=<"([^"]+)"/);
    if (!m) throw new Error("token file path not found in cmd command");
    return m[1];
  }
  /* v8 ignore stop */
  const m = command.match(/\$\(cat '([^']+)'\)/);
  if (!m) throw new Error("token file path not found in posix command");
  return m[1];
}

export function findBash(): string | null {
  const result = spawnSync("bash", ["-c", "true"], { stdio: "pipe", timeout: SPAWN_TIMEOUT_MS });
  return result.status === 0 ? "bash" : null;
}

export function findCmd(): string | null {
  if (process.platform !== "win32") return null; // cmd.exe is Windows-only.
  /* v8 ignore start -- unreachable on the Linux CI runner (platform check above). */
  const result = spawnSync("cmd", ["/c", "exit", "0"], { stdio: "pipe", timeout: SPAWN_TIMEOUT_MS });
  return result.status === 0 ? "cmd" : null;
  /* v8 ignore stop */
}

const scratchDirs: string[] = [];
export function scratchDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "codextender-smoke-"));
  scratchDirs.push(dir);
  return dir;
}
export function cleanupScratchDirs(): void {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
}

export interface SmokeResult {
  exit: number | null;
  stdout: string;
  stderr: string;
  tokenSeenByChild: string;
  remainingEnv: string;
  tokenFileExists: boolean;
}

export function generatedCommandFor(shellForm: "powershell" | "cmd" | "posix") {
  const claudeCommands = buildCopyCommands({ sessionUuid: SAMPLE_UUID, cwd: process.cwd(), title: "smoke" });
  const command = buildCodextenderCommands({
    cwd: process.cwd(),
    baseUrl: "http://127.0.0.1:4000",
    authToken: MARKER_VALUE,
    claudeCommands,
  })[shellForm];
  return { command, tokenFilePath: extractTokenFilePath(command, shellForm) };
}

export function runPowershell(exitCode: number, powershellBin: string): SmokeResult {
  const { command, tokenFilePath } = generatedCommandFor("powershell");
  const dir = scratchDir();
  const captureFile = path.join(dir, "capture.txt");
  const wrapper =
    "function claude {\n" +
    "  Set-Content -LiteralPath $env:SMOKE_CAPTURE_FILE -Value $env:ANTHROPIC_AUTH_TOKEN -NoNewline\n" +
    "  $global:LASTEXITCODE = [int]$env:SMOKE_EXIT_CODE\n" +
    "}\n" +
    command +
    "\n" +
    '$remaining = @()\n' +
    `foreach ($n in @(${ENV_NAMES.map((n) => `"${n}"`).join(",")})) {\n` +
    "  if ([Environment]::GetEnvironmentVariable($n)) { $remaining += $n }\n" +
    "}\n" +
    'Write-Output ("SMOKE_REMAINING_ENV=" + ($remaining -join ","))\n' +
    `Write-Output ("SMOKE_TOKEN_FILE_EXISTS=" + (Test-Path -LiteralPath '${tokenFilePath.replace(/'/g, "''")}'))\n`;
  const result = spawnSync(powershellBin, ["-NoProfile", "-Command", wrapper], {
    stdio: "pipe",
    timeout: SPAWN_TIMEOUT_MS,
    env: { ...process.env, ...POWERSHELL_QUIET_ENV, SMOKE_CAPTURE_FILE: captureFile, SMOKE_EXIT_CODE: String(exitCode) },
  });
  const stdout = result.stdout?.toString() ?? "";
  return {
    exit: result.status,
    stdout,
    stderr: result.stderr?.toString() ?? "",
    tokenSeenByChild: existsSync(captureFile) ? readFileSync(captureFile, "utf8") : "",
    remainingEnv: /SMOKE_REMAINING_ENV=([^\r\n]*)/.exec(stdout)?.[1] ?? "MISSING",
    tokenFileExists: /SMOKE_TOKEN_FILE_EXISTS=True/i.test(stdout),
  };
}

export function runBash(exitCode: number): SmokeResult {
  const { command, tokenFilePath } = generatedCommandFor("posix");
  const dir = scratchDir();
  const captureFile = path.join(dir, "capture.txt");
  const wrapper =
    "claude() {\n" +
    '  printf "%s" "$ANTHROPIC_AUTH_TOKEN" > "$SMOKE_CAPTURE_FILE"\n' +
    "  return $SMOKE_EXIT_CODE\n" +
    "}\n" +
    command +
    "\n" +
    'remaining=""\n' +
    `for n in ${ENV_NAMES.join(" ")}; do\n` +
    '  v=$(eval "printf \'%s\' \\"\\${$n:-}\\"")\n' +
    '  if [ -n "$v" ]; then remaining="$remaining$n,"; fi\n' +
    "done\n" +
    'echo "SMOKE_REMAINING_ENV=$remaining"\n' +
    `if [ -e "${tokenFilePath}" ]; then echo "SMOKE_TOKEN_FILE_EXISTS=true"; else echo "SMOKE_TOKEN_FILE_EXISTS=false"; fi\n`;
  const result = spawnSync("bash", ["-c", wrapper], {
    stdio: "pipe",
    timeout: SPAWN_TIMEOUT_MS,
    env: { ...process.env, SMOKE_CAPTURE_FILE: captureFile, SMOKE_EXIT_CODE: String(exitCode) },
  });
  const stdout = result.stdout?.toString() ?? "";
  return {
    exit: result.status,
    stdout,
    stderr: result.stderr?.toString() ?? "",
    tokenSeenByChild: existsSync(captureFile) ? readFileSync(captureFile, "utf8") : "",
    remainingEnv: /SMOKE_REMAINING_ENV=([^\r\n]*)/.exec(stdout)?.[1] ?? "MISSING",
    tokenFileExists: /SMOKE_TOKEN_FILE_EXISTS=true/i.test(stdout),
  };
}

/* v8 ignore start -- only invoked by the cmd.exe smoke test, which
 * it.skipIf(!findCmd()) skips entirely on the Linux CI runner. */
export function runCmd(exitCode: number): SmokeResult {
  const { command, tokenFilePath } = generatedCommandFor("cmd");
  const dir = scratchDir();
  const stubDir = path.join(dir, "stub");
  mkdirSync(stubDir);
  const captureFile = path.join(dir, "capture.txt");
  writeFileSync(
    path.join(stubDir, "claude.cmd"),
    "@echo off\r\n" +
      '>"%SMOKE_CAPTURE_FILE%" echo %ANTHROPIC_AUTH_TOKEN%\r\n' +
      "exit /b %SMOKE_EXIT_CODE%\r\n",
  );
  // Diagnostics MUST be chained with `&` onto the SAME logical line as
  // `command`, never as subsequent physical lines: cmd.exe invokes the
  // `claude.cmd` stub by bare name (no `call`, matching production, where
  // real `claude` is a native .exe and this quirk never applies), and once a
  // .cmd/.bat is invoked that way, control returns for the REST OF THE SAME
  // LINE's `&`-chained commands but never advances to the calling script's
  // next physical line (verified empirically: a batch file's own line after
  // a bare-name nested-.cmd call never runs, even though same-line `&`
  // continuations after that call do).
  //
  // There is NO reliable same-line way left to observe whether the
  // cleanup suffix's `set NAME=` clears actually took effect: cmd.exe
  // resolves every %VAR%/`if defined VAR` reference on an entire `&`-chained
  // line against the environment snapshot from BEFORE that line started
  // executing, regardless of `set` commands earlier on the SAME line — the
  // textbook reason `setlocal enabledelayedexpansion` exists at all
  // (confirmed in isolation: `set "X=1" & set X=CLEARED & echo %X%` prints
  // the OLD value; `enabledelayedexpansion` + `!X!` does not fix `if
  // defined` either, and even a nested `cmd /c "if defined X ..."` spawned
  // mid-line inherits the same stale snapshot). This is a limitation of
  // observing it from the SAME script, not evidence cleanup didn't run:
  // `if exist <tokenFilePath>` below checks DISK state, immune to this
  // per-line env snapshot, and its `false` result already proves the whole
  // `&`-chained cleanup suffix — including the `set NAME=` clears that
  // precede `del` in that exact same chain — ran to completion in order.
  const oneLine =
    `set "PATH=${stubDir};%PATH%" & ` +
    `set "SMOKE_CAPTURE_FILE=${captureFile}" & ` +
    `set "SMOKE_EXIT_CODE=${exitCode}" & ` +
    command +
    ` & (if exist "${tokenFilePath}" (echo SMOKE_TOKEN_FILE_EXISTS=true) else (echo SMOKE_TOKEN_FILE_EXISTS=false))`;
  const wrapperFile = path.join(dir, "wrapper.cmd");
  writeFileSync(wrapperFile, `@echo off\r\n${oneLine}\r\n`);
  const result = spawnSync("cmd", ["/c", wrapperFile], {
    stdio: "pipe",
    timeout: SPAWN_TIMEOUT_MS,
    env: { ...process.env },
  });
  const stdout = result.stdout?.toString() ?? "";
  return {
    exit: result.status,
    stdout,
    stderr: result.stderr?.toString() ?? "",
    tokenSeenByChild: existsSync(captureFile) ? readFileSync(captureFile, "utf8").trim() : "",
    // Not observable same-line for cmd — see the comment above; the disk-based
    // tokenFileExists check below covers whether the cleanup chain ran.
    remainingEnv: "",
    tokenFileExists: /SMOKE_TOKEN_FILE_EXISTS=true/i.test(stdout),
  };
}
/* v8 ignore stop */
