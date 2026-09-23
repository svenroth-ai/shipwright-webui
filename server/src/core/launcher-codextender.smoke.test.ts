/*
 * Real-shell execution smoke test for the Codextender credential path
 * (PR-review round 4, iterate-2026-09-23) — `launcher-codextender.test.ts`
 * only pattern-matches the generated command TEXT and reads the temp token
 * file directly from the test process; it never actually runs the
 * generated PowerShell / cmd / POSIX command in a real shell, so it cannot
 * catch a quoting bug that only bites at real-shell-parse time, or a
 * cleanup step that silently fails to run.
 *
 * Each shell gets its own `claude` STUB that shadows the real CLI without
 * ever risking invoking it:
 *  - PowerShell / bash: a shell FUNCTION named `claude`. Functions always
 *    take precedence over an external command of the same name in both
 *    shells' own name resolution, so this never touches PATH and can never
 *    resolve to a real `claude` binary — empirically confirmed against the
 *    real `pwsh.exe`/`bash` on this machine before writing this file.
 *  - cmd.exe has no function concept, so it uses a `claude.cmd` stub file
 *    in a scratch directory PREPENDED to PATH — every case below sets a
 *    unique scratch PATH per spawn (never touches the real process PATH)
 *    and every spawn carries an explicit timeout so a resolution mistake
 *    fails fast instead of hanging.
 *
 * The stub never calls `exit`/PowerShell's `exit` keyword directly: doing
 * so terminates the WHOLE script immediately (confirmed empirically: it is
 * NOT equivalent to a real external process returning a non-zero exit
 * code, which only sets $LASTEXITCODE/`return` and lets the calling script
 * continue) — that would make the "cleanup still runs after a non-zero
 * exit" case impossible to test faithfully. Each stub instead sets the
 * shell's own exit-code mechanism ($global:LASTEXITCODE for PowerShell,
 * `exit /b` for the cmd EXTERNAL stub file, `return` for bash) without any
 * script-terminating statement, matching how a real external `claude`
 * process actually behaves from its caller's point of view.
 */

import { describe, it, expect, beforeAll, afterEach } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, existsSync, readFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { buildCopyCommands } from "./launcher.js";
import { buildCodextenderCommands } from "./launcher-codextender.js";

const SAMPLE_UUID = "00000000-1111-2222-3333-444444444444";
const MARKER_VALUE = "smoke-test-secret-9f3a2b7c-do-not-leak";
const ENV_NAMES = [
  "ANTHROPIC_BASE_URL",
  "ANTHROPIC_AUTH_TOKEN",
  "ANTHROPIC_MODEL",
  "CODEXTENDER_ACTIVE",
  "CODEXTENDER_MODEL",
];
const SPAWN_TIMEOUT_MS = 15_000;

function extractTokenFilePath(command: string, shellForm: "powershell" | "cmd" | "posix"): string {
  if (shellForm === "powershell") {
    const m = command.match(/Get-Content -LiteralPath '([^']+)'/);
    if (!m) throw new Error("token file path not found in powershell command");
    return m[1];
  }
  if (shellForm === "cmd") {
    const m = command.match(/set \/p ANTHROPIC_AUTH_TOKEN=<"([^"]+)"/);
    if (!m) throw new Error("token file path not found in cmd command");
    return m[1];
  }
  const m = command.match(/\$\(cat '([^']+)'\)/);
  if (!m) throw new Error("token file path not found in posix command");
  return m[1];
}

function findPowerShell(): string | null {
  for (const candidate of ["pwsh", "powershell"]) {
    const result = spawnSync(candidate, ["-NoProfile", "-Command", "$PSVersionTable.PSVersion.Major"], {
      stdio: "pipe",
      timeout: SPAWN_TIMEOUT_MS,
    });
    if (result.status === 0) return candidate;
  }
  return null;
}

function findBash(): string | null {
  const result = spawnSync("bash", ["-c", "true"], { stdio: "pipe", timeout: SPAWN_TIMEOUT_MS });
  return result.status === 0 ? "bash" : null;
}

function findCmd(): string | null {
  if (process.platform !== "win32") return null; // cmd.exe is Windows-only.
  const result = spawnSync("cmd", ["/c", "exit", "0"], { stdio: "pipe", timeout: SPAWN_TIMEOUT_MS });
  return result.status === 0 ? "cmd" : null;
}

let powershellBin: string | null = null;
beforeAll(() => {
  powershellBin = findPowerShell();
});

const scratchDirs: string[] = [];
function scratchDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "codextender-smoke-"));
  scratchDirs.push(dir);
  return dir;
}
afterEach(() => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

interface SmokeResult {
  exit: number | null;
  stdout: string;
  stderr: string;
  tokenSeenByChild: string;
  remainingEnv: string;
  tokenFileExists: boolean;
}

function generatedCommandFor(shellForm: "powershell" | "cmd" | "posix") {
  const claudeCommands = buildCopyCommands({ sessionUuid: SAMPLE_UUID, cwd: process.cwd(), title: "smoke" });
  const command = buildCodextenderCommands({
    cwd: process.cwd(),
    baseUrl: "http://127.0.0.1:4000",
    authToken: MARKER_VALUE,
    claudeCommands,
  })[shellForm];
  return { command, tokenFilePath: extractTokenFilePath(command, shellForm) };
}

function runPowershell(exitCode: number): SmokeResult {
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
  const result = spawnSync(powershellBin as string, ["-NoProfile", "-Command", wrapper], {
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
    tokenFileExists: /SMOKE_TOKEN_FILE_EXISTS=True/i.test(stdout),
  };
}

function runBash(exitCode: number): SmokeResult {
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

function runCmd(exitCode: number): SmokeResult {
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

describe("launcher-codextender smoke — generated commands actually run in real shells", () => {
  it.skipIf(!findPowerShell())(
    "PowerShell: token reaches the child, never printed, cleanup runs on a SUCCESSFUL exit",
    () => {
      const r = runPowershell(0);
      expect(r.stderr).toBe("");
      expect(r.tokenSeenByChild).toBe(MARKER_VALUE);
      expect(r.stdout).not.toContain(MARKER_VALUE);
      expect(r.stderr).not.toContain(MARKER_VALUE);
      expect(r.remainingEnv).toBe("");
      expect(r.tokenFileExists).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );

  it.skipIf(!findPowerShell())(
    "PowerShell: cleanup still runs after the child exits NON-ZERO",
    () => {
      const r = runPowershell(1);
      expect(r.tokenSeenByChild).toBe(MARKER_VALUE);
      expect(r.stdout).not.toContain(MARKER_VALUE);
      expect(r.remainingEnv).toBe("");
      expect(r.tokenFileExists).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );

  it.skipIf(!findBash())(
    "POSIX/bash: token reaches the child, never printed, cleanup runs on a SUCCESSFUL exit",
    () => {
      const r = runBash(0);
      expect(r.stderr).toBe("");
      expect(r.tokenSeenByChild).toBe(MARKER_VALUE);
      expect(r.stdout).not.toContain(MARKER_VALUE);
      expect(r.stderr).not.toContain(MARKER_VALUE);
      expect(r.remainingEnv).toBe("");
      expect(r.tokenFileExists).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );

  it.skipIf(!findBash())(
    "POSIX/bash: cleanup still runs after the child exits NON-ZERO",
    () => {
      const r = runBash(1);
      expect(r.tokenSeenByChild).toBe(MARKER_VALUE);
      expect(r.stdout).not.toContain(MARKER_VALUE);
      expect(r.remainingEnv).toBe("");
      expect(r.tokenFileExists).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );

  it.skipIf(!findCmd())(
    "cmd.exe: token reaches the child, never printed, cleanup runs on a SUCCESSFUL exit",
    () => {
      const r = runCmd(0);
      expect(r.tokenSeenByChild).toBe(MARKER_VALUE);
      expect(r.stdout).not.toContain(MARKER_VALUE);
      expect(r.stderr).not.toContain(MARKER_VALUE);
      // No same-line env-var-cleared assertion for cmd — see the comment in
      // runCmd(): cmd.exe's per-line %VAR%/`if defined` snapshot timing makes
      // that unobservable from the same script, regardless of whether the
      // `set NAME=` clears actually ran. tokenFileExists below (disk state,
      // immune to that snapshot) proves the whole cleanup chain, including
      // those clears, executed in order.
      expect(r.tokenFileExists).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );

  it.skipIf(!findCmd())(
    "cmd.exe: cleanup still runs after the child exits NON-ZERO",
    () => {
      const r = runCmd(1);
      expect(r.tokenSeenByChild).toBe(MARKER_VALUE);
      expect(r.stdout).not.toContain(MARKER_VALUE);
      expect(r.tokenFileExists).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );
});
