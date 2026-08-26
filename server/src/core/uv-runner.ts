/*
 * uv-runner — resolves `uv` for call sites that must run a plugin-owned Python
 * script IN THE ENGINE'S OWN ENVIRONMENT (grade.py, triage_cli.py), not the
 * server's ambient interpreter (root cause of the ModuleNotFoundError bug:
 * grade-runner / triage-cli-runner used to spawn `resolvePython()`'s raw
 * python3/python/py — whichever answered `--version` first, unversioned and
 * dependency-free — instead of the `uv run`-managed environment both scripts
 * are built for).
 *
 * `resolveUv` test-runs `uv --version` (never assumed present) via the same
 * PATH-augmented probe `readiness-probe-run.ts` uses (`~/.local/bin` etc. —
 * the uv installer only appends that dir to a shell rc, so a server spawned
 * before a fresh install would otherwise ENOENT a real uv), then resolves the
 * actual bin + env a REAL spawn needs — reusing `probeEnv`/`resolvePosixBin`
 * from `readiness-probe-path.ts` rather than re-deriving PATH logic.
 *
 * Returns null when uv is genuinely absent. Callers MUST surface an honest
 * "engine unavailable" in that case — never fall back to a bare system
 * python, which is the exact silent-fallback this module replaces.
 */

import os from "node:os";

import { probeEnv, resolvePosixBin } from "./readiness-probe-path.js";
import { defaultRun, type RunFn } from "./readiness-probe-run.js";

export interface UvResolution {
  /** Absolute path (POSIX) or the bare "uv" (win32 — libuv reads PATH from
   *  the child env block, so a literal name plus the augmented `env` resolves
   *  it; mirrors `defaultRun`'s own win32/POSIX split). */
  bin: string;
  /** PATH-augmented env to hand to the actual `uv run` spawn. */
  env: NodeJS.ProcessEnv;
}

export interface ResolveUvDeps {
  /** `--version` runner used for the presence probe (test seam). */
  run?: RunFn;
  platform?: NodeJS.Platform;
  homeDir?: string;
  /** Base env the augmented PATH is layered onto (defaults to process.env). */
  baseEnv?: NodeJS.ProcessEnv;
}

/**
 * Test-run `uv --version`; on success resolve the bin + env a real `uv run`
 * spawn needs. Null means "uv isn't there" — not "python isn't there".
 */
export async function resolveUv(deps: ResolveUvDeps = {}): Promise<UvResolution | null> {
  const run = deps.run ?? defaultRun;
  const probe = await run("uv", ["--version"]);
  if (!probe.ok) return null;

  const platform = deps.platform ?? process.platform;
  const homeDir = deps.homeDir ?? os.homedir();
  const env = probeEnv(platform, homeDir, deps.baseEnv ?? process.env);
  const bin = platform === "win32" ? "uv" : resolvePosixBin("uv", env);
  return { bin, env };
}
