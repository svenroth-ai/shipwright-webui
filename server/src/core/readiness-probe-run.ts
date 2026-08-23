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
      (error, stdout, stderr) => {
        const out = String(stdout ?? "");
        const err = String(stderr ?? "");
        // execFile sets `error` on a non-zero exit, a spawn failure (ENOENT) OR
        // a timeout (killed) — all of which mean "did not run cleanly". A real
        // tool exits 0 (no error) AND prints a version; the MS-Store python3 stub
        // exits non-zero, so requiring no-error + a digit-bearing line rejects it
        // (the whole reason this is not `command -v`).
        const ok = !error && /\d+\.\d+/.test(out + err);
        // Numeric exit status on non-zero exit; ENOENT/timeout set a STRING code
        // / `killed` → report null so a code-gated caller never reads them as 0.
        const errCode = (error as { code?: unknown } | null)?.code;
        const code = error == null ? 0 : typeof errCode === "number" ? errCode : null;
        resolve({ ok, stdout: out, stderr: err, code });
      },
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
