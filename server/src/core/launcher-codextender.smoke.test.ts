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
 *
 * Shell-spawning plumbing lives in launcher-codextender.smoke-helpers.ts
 * (bloat anti-ratchet, 2026-09-28 — this file crossed 300 lines once
 * CLAUDE_CODE_AUTO_MODE_SERVER coverage was added).
 */

import { describe, it, expect, afterEach } from "vitest";

import {
  MARKER_VALUE,
  cleanupScratchDirs,
  findBash,
  findCmd,
  runBash,
  runCmd,
  runPowershell,
  SPAWN_TIMEOUT_MS,
} from "./launcher-codextender.smoke-helpers.js";
import { powershellSkip, requirePowerShell } from "./powershell-probe.smoke-helpers.js";

afterEach(() => {
  cleanupScratchDirs();
});

describe("launcher-codextender smoke — generated commands actually run in real shells", () => {
  it.skipIf(powershellSkip())(
    "PowerShell: token reaches the child, never printed, cleanup runs on a SUCCESSFUL exit",
    () => {
      const r = runPowershell(0, requirePowerShell());
      expect(r.stderr).toBe("");
      expect(r.tokenSeenByChild).toBe(MARKER_VALUE);
      expect(r.stdout).not.toContain(MARKER_VALUE);
      expect(r.stderr).not.toContain(MARKER_VALUE);
      expect(r.remainingEnv).toBe("");
      expect(r.tokenFileExists).toBe(false);
    },
    SPAWN_TIMEOUT_MS,
  );

  it.skipIf(powershellSkip())(
    "PowerShell: cleanup still runs after the child exits NON-ZERO",
    () => {
      const r = runPowershell(1, requirePowerShell());
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
