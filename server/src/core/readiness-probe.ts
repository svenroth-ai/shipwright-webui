/*
 * readiness-probe — the FIRST-CONTACT readiness GATE, server-side (FR-01.51).
 *
 * "One truth, two surfaces": the Command Center's Intent-Wizard door picker
 * (A08) and First Contact (A14) both gate on THE SAME set the npx bootstrapper's
 * preflight checks — because promising "ready" on the first screen a user sees,
 * without checking, is the same lie as an installer that reports success over a
 * dead install. The bootstrapper (`bootstrapper/lib/preflight.mjs`) is a Node
 * CLI; the browser cannot spawn subprocesses, so this module re-expresses the
 * SAME check set server-side and the wizard reads it over `/api/readiness`.
 *
 * The check set (what actually kills a first run):
 *   - Claude CLI (>= MIN_SUPPORTED_CLI)  — the engine the Command Center drives
 *   - Shipwright plugins installed       — no plugins = a cockpit with no engine
 *   - Coherent plugin cache (shared/)    — `claude plugin install` does NOT
 *                                          deliver `cache/shipwright/shared/`,
 *                                          into which every hook resolves (A06 §2b)
 *   - uv                                 — 159 `uv run` hook call-sites die without it
 *   - a WORKING Python (>= 3.11)         — TEST-RUN, never mere PATH presence
 *                                          (Windows `python3` is a Store stub)
 *   - git                                — the SDLC plugins are git-based
 *
 * Pure over its injected seams (`run`, `existsFn`, `readdirFn`, `homeDir`,
 * `platform`, `claude`) so every branch is unit-testable without a real
 * toolchain and the route can memoise a single probe.
 *
 * NOT a cross-package import of preflight.mjs (CLAUDE.md rule 7 / DO-NOT #7 —
 * no cross-package imports; shared shapes are verbatim-mirrored + guarded). The
 * check SET and the probe methodology are the shared truth; this is its server
 * mirror.
 */

import { spawnSync } from "node:child_process";
import { existsSync as fsExistsSync, readdirSync as fsReaddirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

/** The one command that repairs every not-ready check (installs plugins + syncs the cache). */
export const READINESS_REPAIR_COMMAND = "npx @svenroth-ai/shipwright@latest";

/** Minimum working Python the plugin hooks require. */
export const MIN_PYTHON = "3.11.0";

export interface ReadinessCheck {
  /** Stable id: claude | plugins | cache | uv | python | git. */
  key: string;
  /** Human label ("Claude CLI", "Shipwright plugins", …). */
  label: string;
  ok: boolean;
  /** Version / count / "not found" — the concrete finding. */
  detail: string;
  /** Plain-language why-it-matters (empty for the self-evident ones). */
  why: string;
  /** A door is pointless without it. All six are critical today. */
  critical: boolean;
}

export interface ReadinessReport {
  /** Every critical check passed → the doors may open. */
  ready: boolean;
  checks: ReadinessCheck[];
  /** Printed under the not-ready list — the ONE command that fixes all of it. */
  repairCommand: string;
}

export interface RunResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}
export type RunFn = (cmd: string, args?: string[]) => RunResult;

/**
 * Default runner: `<cmd> --version` and report whether it actually RAN. On
 * Windows the tools are `.cmd`/`.bat` shims (git, uv) that shell:false cannot
 * resolve (PATHEXT ignored), so we go through the shell there — cmd + args are
 * fixed internal literals (tool name + `--version`), no injection surface.
 * Mirrors bootstrapper/lib/preflight.mjs `defaultRun`.
 */
export function defaultRun(cmd: string, args: string[] = ["--version"]): RunResult {
  try {
    const isWin = process.platform === "win32";
    // cmd is a fixed literal (uv/python3/python/py/git) with a fixed `--version`
    // arg and no user input; shell:true is the Windows-only `.cmd` resolution
    // branch (PATHEXT ignored by shell:false). No injection surface — same
    // pattern (single line + trailing nosemgrep) as bootstrapper/lib/preflight.mjs.
    const joined = [cmd, ...args].join(" ");
    const r = isWin
      ? spawnSync(joined, { encoding: "utf-8", shell: true, timeout: 8000 }) // nosemgrep: javascript.lang.security.audit.spawn-shell-true.spawn-shell-true
      : spawnSync(cmd, args, { encoding: "utf-8", shell: false, timeout: 8000 });
    const stdout = String(r.stdout ?? "");
    const stderr = String(r.stderr ?? "");
    // A real tool exits 0 AND prints a version. The MS-Store python3 stub exits
    // non-zero (or nags), so requiring both status 0 and a digit-bearing line
    // rejects it — the whole reason this is not `command -v`.
    const ok = r.status === 0 && !r.error && /\d+\.\d+/.test(stdout + stderr);
    return { ok, stdout, stderr };
  } catch {
    return { ok: false, stdout: "", stderr: "" };
  }
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
export function resolvePython(run: RunFn): { bin: string; version: string } | null {
  for (const bin of ["python3", "python", "py"]) {
    const r = run(bin, ["--version"]);
    if (r.ok) return { bin, version: extractVersion(r.stdout + r.stderr) };
  }
  return null;
}

export interface ProbeDeps {
  run?: RunFn;
  existsFn?: (p: string) => boolean;
  readdirFn?: (p: string) => string[];
  homeDir?: string;
  /** Claude CLI verdict from the shared cli-compat probe (already resolved). */
  claude: { supported: boolean; raw: string; minSupported: string };
}

/** `<home>/.claude/plugins/cache/shipwright` — the marketplace cache root (A06). */
export function shipwrightCacheRoot(homeDir: string): string {
  return path.join(homeDir, ".claude", "plugins", "cache", "shipwright");
}

/**
 * The plugins the wizard's doors DIRECTLY invoke. A cache full of `shipwright-*`
 * dirs is not enough — if `shipwright-adopt`/`shipwright-grade` are absent, the
 * Adopt/Grade doors open into a missing command. Checking these two (rather than
 * hardcoding the whole manifest, which A06 derives) is the honest floor.
 */
export const DOOR_REQUIRED_PLUGINS = ["shipwright-adopt", "shipwright-grade"] as const;

/**
 * Run the readiness probe. Pure over its seams; the route calls it with the
 * real fs + spawn + the live cli-compat verdict.
 */
export function probeReadiness(deps: ProbeDeps): ReadinessReport {
  const run = deps.run ?? defaultRun;
  const existsFn = deps.existsFn ?? fsExistsSync;
  const readdirFn = deps.readdirFn ?? ((p: string) => fsReaddirSync(p));
  const homeDir = deps.homeDir ?? os.homedir();
  const cacheRoot = shipwrightCacheRoot(homeDir);

  const checks: ReadinessCheck[] = [];

  // Claude CLI — the engine. Verdict comes pre-resolved from cli-compat.
  checks.push({
    key: "claude",
    label: "Claude CLI",
    ok: deps.claude.supported,
    detail: deps.claude.supported
      ? deps.claude.raw || "detected"
      : deps.claude.raw
        ? `${deps.claude.raw} (need >= ${deps.claude.minSupported})`
        : "not found",
    why: "the engine the Command Center drives",
    critical: true,
  });

  // Shipwright plugins installed — the marketplace cache holds one dir per plugin.
  // A door-critical plugin that is absent means that door opens into a missing
  // command, so "some plugins installed" is not the same as "ready".
  let pluginNames: string[] = [];
  try {
    pluginNames = readdirFn(cacheRoot).filter((n) => n.startsWith("shipwright-"));
  } catch {
    pluginNames = [];
  }
  const installed = new Set(pluginNames);
  const missingRequired = DOOR_REQUIRED_PLUGINS.filter((p) => !installed.has(p));
  const pluginsOk = pluginNames.length > 0 && missingRequired.length === 0;
  checks.push({
    key: "plugins",
    label: "Shipwright plugins",
    ok: pluginsOk,
    detail:
      pluginNames.length === 0
        ? "none installed"
        : missingRequired.length > 0
          ? `${pluginNames.length} installed, missing: ${missingRequired.join(", ")}`
          : `${pluginNames.length} installed`,
    why: "without them there are no /shipwright-* commands at all",
    critical: true,
  });

  // Coherent plugin cache — the shared/ canary every hook resolves into. This is
  // the tree `claude plugin install` does NOT deliver (A06 §2b).
  const canary = path.join(cacheRoot, "shared", "scripts", "hooks", "capture_session_id.py");
  const cacheOk = existsFn(canary);
  checks.push({
    key: "cache",
    label: "Plugin cache",
    ok: cacheOk,
    detail: cacheOk ? "shared/ present" : "shared/ missing",
    why: "every plugin hook resolves into cache/shipwright/shared/",
    critical: true,
  });

  // uv — every hook shells through it.
  const uv = run("uv", ["--version"]);
  checks.push({
    key: "uv",
    label: "uv",
    ok: uv.ok,
    detail: uv.ok ? extractVersion(uv.stdout + uv.stderr) : "not found",
    why: "every plugin hook runs through it",
    critical: true,
  });

  // python — TEST-RUN probe (Store-stub trap), require >= 3.11.
  const py = resolvePython(run);
  const pyOk = py != null && compareVersions(py.version, MIN_PYTHON) >= 0;
  checks.push({
    key: "python",
    label: "Python",
    ok: pyOk,
    detail: py
      ? pyOk
        ? `${py.version} (${py.bin})`
        : `${py.version} (need >= ${MIN_PYTHON})`
      : "not found (tried python3, python, py)",
    why: "the shared scripts run on it",
    critical: true,
  });

  // git — the SDLC plugins are git-based.
  const git = run("git", ["--version"]);
  checks.push({
    key: "git",
    label: "git",
    ok: git.ok,
    detail: git.ok ? extractVersion(git.stdout + git.stderr) : "not found",
    why: "",
    critical: true,
  });

  const ready = checks.every((c) => c.ok || !c.critical);
  return { ready, checks, repairCommand: READINESS_REPAIR_COMMAND };
}
