/*
 * readiness-probe-run — the toolchain PROBE runner + version-parsing primitives
 * (FR-01.51). Split out of readiness-probe.ts (which crossed the 300-LOC
 * guideline) along its natural seam: "how to run a `--version` probe and parse
 * it" is distinct from "assemble the readiness gate" (probeReadiness). Both are
 * re-exported from readiness-probe.ts, so every existing importer of these
 * symbols keeps its import path — this is a pure cohesive extraction.
 */

import { execFile } from "node:child_process";
import os from "node:os";

import { probeEnv, resolvePosixBin } from "./readiness-probe-path.js";
import { resolveSpawn } from "./win32-spawn.js";

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
  /** Exit code: 0 clean, the status on non-zero exit, `null` on ENOENT/timeout.
   *  The uv python-find fallback gates on THIS, not the version-shaped `ok`:
   *  `uv python find` prints a decimal-less PATH on a clean exit (#380 lesson). */
  code?: number | null;
}
export type RunFn = (cmd: string, args?: string[]) => Promise<RunResult>;

/** Per-probe timeout. A `--version` that hangs longer than this is treated as
 *  "not found" — the process is killed, and because the runner is ASYNC the
 *  event loop is never blocked while it waits. */
export const PROBE_TIMEOUT_MS = 8000;

/**
 * Default runner: `<cmd> --version` and report whether it actually RAN — ASYNC.
 *
 * `execFile` (NOT `spawnSync`) so the probe never blocks the event loop: the
 * `/api/readiness` handler shares the single-threaded loop with the live
 * embedded-terminal WebSockets and the 1s transcript poll, so a tool that hangs
 * on `--version` must not freeze every open connection. shell:false (execFile
 * default) — no shell process, no injection surface. The probed tools (`uv`,
 * `python*`, `git`) are real executables, so Windows resolves them by bare name
 * (appends `.exe`; verified git/python/py/uv all run). This is deliberately NOT
 * the bootstrapper preflight.mjs case, which shells out ONLY to resolve `.cmd`
 * shims (claude/npm/gh) — none of those are probed here.
 *
 * PATH augmentation (iterate-2026-08-23): the probe runs with a lookup PATH
 * extended by `probeEnv` to include `~/.local/bin` (+ Homebrew on POSIX), because
 * the uv installer drops its binary there and only appends it to the shell rc —
 * the server process, spawned before that, would otherwise ENOENT a
 * perfectly-installed uv and the readiness gate would skip the uv-managed-Python
 * fallback (report system python3 3.9.6).
 *
 * The POSIX vs win32 asymmetry is deliberate and follows from how each platform
 * resolves a bare name: POSIX `execvp` searches the PARENT process environ, NOT
 * `options.env`, so the augmented PATH would be ignored — hence on POSIX we
 * resolve the bare name to an ABSOLUTE path ourselves (`resolvePosixBin`) and
 * spawn that. On win32, libuv's `search_path` reads PATH from the CHILD env
 * block, so handing the augmented `env` to execFile is enough and it finds the
 * .exe (verified end-to-end in readiness-probe-run.test.ts — a .exe present only
 * in %USERPROFILE%\.local\bin, off the process PATH, is located). The probed
 * tools are real executables (uv.exe/python.exe/git.exe), never `.cmd` shims, so
 * no PATHEXT-shim resolution (the bootstrapper's win32-spawn case) is needed
 * here. `deps` (platform/homedir/env) is a test seam.
 */
export function defaultRun(
  cmd: string,
  args: string[] = ["--version"],
  deps: { platform?: NodeJS.Platform; homedir?: string; env?: NodeJS.ProcessEnv } = {},
): Promise<RunResult> {
  const platform = deps.platform ?? process.platform;
  const homedir = deps.homedir ?? os.homedir();
  const env = probeEnv(platform, homedir, deps.env ?? process.env);
  const target = platform === "win32" ? cmd : resolvePosixBin(cmd, env);
  return new Promise((resolve) => {
    execFile(
      target,
      args,
      { encoding: "utf-8", timeout: PROBE_TIMEOUT_MS, windowsHide: true, env },
      (error, stdout, stderr) => resolve(parseExecResult(error, stdout, stderr)),
    );
  });
}

/**
 * Shared execFile-callback → RunResult parsing for `defaultRun` and
 * `defaultRunShim` (extracted iterate-2026-09-16-codex-probe-win32-shim, both
 * callers need the identical ok/code contract; see `defaultRun`'s own doc
 * comment for why `ok` requires no-error-AND-a-digit and why `code` is `null`
 * rather than a string on ENOENT/timeout).
 */
function parseExecResult(
  error: (Error & { code?: unknown }) | null,
  stdout: unknown,
  stderr: unknown,
): RunResult {
  const out = String(stdout ?? "");
  const err = String(stderr ?? "");
  const ok = !error && /\d+\.\d+/.test(out + err);
  const errCode = error?.code;
  const code = error == null ? 0 : typeof errCode === "number" ? errCode : null;
  return { ok, stdout: out, stderr: err, code };
}

/**
 * Probe a command that may resolve as a Windows PATHEXT SHIM (`.cmd`/`.bat`)
 * rather than a genuine `.exe` — e.g. `codex`, which the Codex CLI installer
 * drops on Windows as a `.cmd` wrapper (no `codex.exe`). `defaultRun` is
 * deliberately `.exe`-only (its own doc comment: "This is deliberately NOT
 * the bootstrapper preflight.mjs case, which shells out ONLY to resolve
 * `.cmd` shims") — `execFile(cmd, args, {shell:false})` cannot invoke a
 * `.cmd` without a shell (Node's CVE-2024-27980 hardening), so probing codex
 * through `defaultRun` throws ENOENT even when Codex CLI is genuinely
 * installed and working (iterate-2026-09-16-codex-probe-win32-shim).
 *
 * This is a SIBLING, not a `defaultRun` edit, because `defaultRun`'s win32
 * branch is load-bearing for a DIFFERENT fix: it hands execFile the
 * `probeEnv`-augmented `env` so a `~/.local/bin`-only uv is still found
 * (iterate-2026-08-23; proven in readiness-probe-run.test.ts). `resolveSpawn`
 * (ADR-044) has no `env` parameter — it resolves PATH from the real
 * `process.env.PATH` only — so routing `defaultRun` itself through it would
 * silently regress that augmented-PATH lookup for uv/python/git. Codex has no
 * such augmented-PATH need (its installer puts the shim straight on PATH), so
 * this sibling can use `resolveSpawn` unconditionally on win32 without that
 * risk.
 *
 * POSIX is a pass-through to `defaultRun` — `execvp` already resolves a shim
 * script (or any executable) by bare name, no `.cmd`/`.bat` concept exists.
 *
 * CAVEAT for a future caller: unlike `defaultRun`, this does NOT augment the
 * lookup PATH — it resolves strictly from the real `process.env.PATH`
 * (`resolveSpawn` takes no `env` override; that is the whole reason this is a
 * sibling and not a `defaultRun` edit, per above). Fine for `codex`: unlike
 * uv, whose specific installer script's KNOWN behavior is dropping to
 * `~/.local/bin` without touching PATH until the next shell start (the
 * concrete, previously-reported failure that justified `probeEnv`'s
 * augmentation), no Codex CLI install method is known to place the shim
 * anywhere off the server process's inherited PATH — it is an ordinary PATH
 * shim like the already-working `claude`/`npm`/`gh` ones `win32-spawn.ts`
 * already resolves elsewhere in this codebase. If that assumption turns out
 * wrong for some install method, the fix is the same shape `probeEnv` already
 * is: report the concrete failure, then add an equivalent augmentation here —
 * not to speculate one in now against no observed case. A tool that already
 * needs the `~/.local/bin`-style augmented lookup should keep using
 * `defaultRun`, not this.
 *
 * SECURITY INVARIANT this function relies on, not enforces: `cmd`/`args` MUST
 * be literal constants, never externally-influenced. Unlike the ONE existing
 * caller of `resolveSpawn` (`preview-session-manager.tokenizeCommand`, a
 * BLOCKLIST fence against shell metacharacters and `%…%` expansion),
 * `defaultRunShim` calls `resolveSpawn` with NO fence in between — per
 * `win32-spawn.ts`'s own header, "this module never assumes [the fence] ran".
 * Today's two callers (`isCodexCliAvailable`, `probeReadiness`'s codex arm)
 * both pass the hardcoded literal `"codex"`/`["--version"]`, so there is
 * nothing to inject — but a future caller reusing this exported, generically
 * named function with any externally-influenced `cmd`/`args` would silently
 * inherit `win32CmdWrap`'s unfenced cmd.exe quoting (a token containing
 * `&|<>^` or a space triggers the verbatim-quoted branch; `%VAR%` is never
 * neutralized by quoting at all). Add a fence at the call site before doing
 * that, the same way the preview caller does.
 */
export function defaultRunShim(
  cmd: string,
  args: string[] = ["--version"],
  deps: { platform?: NodeJS.Platform; cwd?: string } = {},
): Promise<RunResult> {
  const platform = deps.platform ?? process.platform;
  if (platform !== "win32") {
    return defaultRun(cmd, args, { platform });
  }
  const cwd = deps.cwd ?? process.cwd();
  const resolved = resolveSpawn([cmd, ...args], cwd);
  if (!resolved) {
    return Promise.resolve({ ok: false, stdout: "", stderr: "", code: null });
  }
  return new Promise((resolve) => {
    execFile(
      resolved.command,
      resolved.args,
      {
        encoding: "utf-8",
        timeout: PROBE_TIMEOUT_MS,
        windowsHide: true,
        windowsVerbatimArguments: resolved.windowsVerbatimArguments,
      },
      (error, stdout, stderr) => resolve(parseExecResult(error, stdout, stderr)),
    );
  });
}

/** First `\d+.\d+(.\d+)?` token in a `--version` blob, or "". */
export function extractVersion(out: string): string {
  const m = /(\d+\.\d+(?:\.\d+)?)/.exec(String(out ?? ""));
  return m ? m[1] : "";
}

/** Numeric semver-ish compare: -1 / 0 / 1. Missing segments are 0. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split(".").map((x) => parseInt(x, 10) || 0);
  const pb = b.split(".").map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

/**
 * Resolve ONE working Python by TEST-RUNNING `--version` (python3 → python →
 * py). The MS-Store stub fails `run().ok` and is skipped.
 */
export async function resolvePython(run: RunFn): Promise<{ bin: string; version: string } | null> {
  for (const bin of ["python3", "python", "py"]) {
    const r = await run(bin, ["--version"]);
    if (r.ok) return { bin, version: extractVersion(r.stdout + r.stderr) };
  }
  return null;
}
