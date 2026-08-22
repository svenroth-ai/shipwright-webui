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

import { existsSync as fsExistsSync, readdirSync as fsReaddirSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { installHint } from "./readiness-install-hints.js";
import {
  compareVersions,
  defaultRun,
  extractVersion,
  resolvePython,
  type RunFn,
  type RunResult,
} from "./readiness-probe-run.js";

// Re-export the probe RUN + version primitives (moved to readiness-probe-run.ts
// for the 300-LOC guideline) so every existing importer keeps its path stable.
export {
  compareVersions,
  defaultRun,
  extractVersion,
  resolvePython,
  PROBE_TIMEOUT_MS,
  type RunFn,
  type RunResult,
} from "./readiness-probe-run.js";

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
  /** OS-aware install command for a missing TOOLCHAIN check (claude/uv/python/
   *  git). Absent when the check passes and on plugins/cache — `repairCommand`
   *  (npx) installs those, but never the toolchain. */
  hint?: string;
}

export interface ReadinessReport {
  /** Every critical check passed → the doors may open. */
  ready: boolean;
  checks: ReadinessCheck[];
  /** Printed under the not-ready list — the ONE command that fixes all of it. */
  repairCommand: string;
}

export interface ProbeDeps {
  run?: RunFn;
  existsFn?: (p: string) => boolean;
  readdirFn?: (p: string) => string[];
  homeDir?: string;
  /** OS for the install hints (test seam); defaults to `process.platform`. */
  platform?: NodeJS.Platform;
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
 * Run the readiness probe — ASYNC. Pure over its seams; the route calls it with
 * the real fs + execFile + the live cli-compat verdict. The three independent
 * tool arms (uv · python · git) run in parallel (Promise.all); the python arm
 * itself may run up to 3 sequential probes (python3 → python → py) plus the
 * one-shot uv-managed fallback, so the gate is bounded by the SLOWEST ARM (not
 * the sum of arms). The event loop is never blocked (execFile is async) and each
 * probe is timeout-capped, so a hanging binary slows only the first uncached read.
 */
export async function probeReadiness(deps: ProbeDeps): Promise<ReadinessReport> {
  const run = deps.run ?? defaultRun;
  const existsFn = deps.existsFn ?? fsExistsSync;
  const readdirFn = deps.readdirFn ?? ((p: string) => fsReaddirSync(p));
  const homeDir = deps.homeDir ?? os.homedir();
  const platform = deps.platform ?? process.platform;
  const cacheRoot = shipwrightCacheRoot(homeDir);

  // Fire the independent toolchain arms concurrently — the event loop is free
  // the whole time (execFile is async). The python arm may run up to 3 sequential
  // probes internally (resolvePython), so the wait is max(uv, PYTHON-ARM, git).
  const [uv, py, git] = await Promise.all([
    run("uv", ["--version"]),
    resolvePython(run),
    run("git", ["--version"]),
  ]);

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
    hint: deps.claude.supported ? undefined : installHint("claude", platform),
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

  // uv — every hook shells through it (probed above, in parallel).
  checks.push({
    key: "uv",
    label: "uv",
    ok: uv.ok,
    detail: uv.ok ? extractVersion(uv.stdout + uv.stderr) : "not found",
    why: "every plugin hook runs through it",
    critical: true,
    hint: uv.ok ? undefined : installHint("uv", platform),
  });

  // python — TEST-RUN probe (Store-stub trap), require >= 3.11 (probed above).
  // The stack runs every hook via `uv run`, which resolves a uv-MANAGED
  // interpreter — so a system python3 >= 3.11 satisfies the gate, but so does uv
  // being able to PROVIDE 3.11+ (the common Mac case where `uv python install
  // 3.11` left system `python3` at 3.9). Mirrors preflight.mjs's python gate.
  const sysPyOk = py != null && compareVersions(py.version, MIN_PYTHON) >= 0;
  let pyOk = sysPyOk;
  let pyDetail = py
    ? sysPyOk
      ? `${py.version} (${py.bin})`
      : `${py.version} (need >= ${MIN_PYTHON})`
    : "not found (tried python3, python, py)";
  if (!pyOk && uv.ok) {
    // `uv python find >=3.11` locates an installed 3.11+ WITHOUT downloading.
    // Gate on EXIT CODE, not the version-shaped `ok`: it prints a PATH, and a
    // decimal-less path (e.g. a `/usr/local/bin/python3` symlink) would fail the
    // `\d+\.\d+` test despite a clean exit. uv exits 0 on a hit, 2 on a miss.
    const uvPy = await run("uv", ["python", "find", ">=3.11"]);
    if (uvPy.code === 0) {
      pyOk = true;
      pyDetail = `${extractVersion(uvPy.stdout + uvPy.stderr) || "3.11+"} (uv-managed)`;
    }
  }
  checks.push({
    key: "python",
    label: "Python",
    ok: pyOk,
    detail: pyDetail,
    why: "the shared scripts run on it",
    critical: true,
    hint: pyOk ? undefined : installHint("python", platform),
  });

  // git — the SDLC plugins are git-based (probed above, in parallel).
  checks.push({
    key: "git",
    label: "git",
    ok: git.ok,
    detail: git.ok ? extractVersion(git.stdout + git.stderr) : "not found",
    why: "",
    critical: true,
    hint: git.ok ? undefined : installHint("git", platform),
  });

  const ready = checks.every((c) => c.ok || !c.critical);
  return { ready, checks, repairCommand: READINESS_REPAIR_COMMAND };
}
