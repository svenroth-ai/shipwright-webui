/*
 * Readiness-probe unit tests (FR-01.51). Fully deterministic — every toolchain
 * seam is injected, so nothing spawns and nothing touches the real filesystem.
 */

import path from "node:path";

import { describe, it, expect } from "vitest";

import {
  probeReadiness,
  compareVersions,
  extractVersion,
  resolvePython,
  shipwrightCacheRoot,
  READINESS_REPAIR_COMMAND,
  type RunFn,
  type RunResult,
} from "./readiness-probe.js";

const HOME = path.join("/home", "tester");
// Build the expected paths with the SAME path.join the probe uses, so the seams
// match on every platform separator (Windows `\` vs POSIX `/`).
const CACHE_ROOT = shipwrightCacheRoot(HOME);
const CANARY = path.join(CACHE_ROOT, "shared", "scripts", "hooks", "capture_session_id.py");

function okRun(version: string): RunResult {
  return { ok: true, stdout: `tool ${version}`, stderr: "" };
}
const NOT_FOUND: RunResult = { ok: false, stdout: "", stderr: "" };

/** A run() where every tool reports a good version. */
const allToolsRun: RunFn = (cmd) => {
  if (cmd === "python3") return okRun("3.13.1");
  return okRun("2.0.0");
};

/** A healthy fs: canary present, 8 shipwright plugin dirs. */
function healthyFs() {
  return {
    existsFn: (p: string) => p === CANARY,
    readdirFn: (p: string) =>
      p === CACHE_ROOT
        ? ["shipwright-iterate", "shipwright-grade", "shipwright-adopt", "shared", "plugins"]
        : [],
  };
}

const CLAUDE_OK = { supported: true, raw: "2.1.9", minSupported: "2.0.0" };

describe("probeReadiness", () => {
  it("all-green → ready, all six checks pass, canonical repair command", () => {
    const r = probeReadiness({
      run: allToolsRun,
      homeDir: HOME,
      claude: CLAUDE_OK,
      ...healthyFs(),
    });
    expect(r.ready).toBe(true);
    expect(r.repairCommand).toBe(READINESS_REPAIR_COMMAND);
    expect(r.checks.map((c) => c.key)).toEqual([
      "claude",
      "plugins",
      "cache",
      "uv",
      "python",
      "git",
    ]);
    expect(r.checks.every((c) => c.ok)).toBe(true);
    // The plugins check counts only shipwright-* dirs (not shared/ or plugins/).
    expect(r.checks.find((c) => c.key === "plugins")?.detail).toBe("3 installed");
  });

  it("uv missing → NOT ready, and names uv with its why", () => {
    const run: RunFn = (cmd) =>
      cmd === "uv" ? NOT_FOUND : cmd === "python3" ? okRun("3.12.0") : okRun("2.0.0");
    const r = probeReadiness({ run, homeDir: HOME, claude: CLAUDE_OK, ...healthyFs() });
    expect(r.ready).toBe(false);
    const uv = r.checks.find((c) => c.key === "uv");
    expect(uv?.ok).toBe(false);
    expect(uv?.detail).toBe("not found");
    expect(uv?.why).toMatch(/hook/i);
  });

  it("Windows Store python stub (fails test-run) → python NOT ok even though on PATH", () => {
    // The stub is on PATH but every invocation fails run().ok — resolvePython skips it.
    const run: RunFn = (cmd) => (cmd === "python3" || cmd === "python" || cmd === "py" ? NOT_FOUND : okRun("2.0.0"));
    const r = probeReadiness({ run, homeDir: HOME, claude: CLAUDE_OK, ...healthyFs() });
    expect(r.ready).toBe(false);
    const py = r.checks.find((c) => c.key === "python");
    expect(py?.ok).toBe(false);
    expect(py?.detail).toMatch(/not found/);
  });

  it("python present but < 3.11 → NOT ok", () => {
    const run: RunFn = (cmd) => (cmd === "python3" ? okRun("3.9.7") : okRun("2.0.0"));
    const r = probeReadiness({ run, homeDir: HOME, claude: CLAUDE_OK, ...healthyFs() });
    const py = r.checks.find((c) => c.key === "python");
    expect(py?.ok).toBe(false);
    expect(py?.detail).toMatch(/need >= 3\.11/);
    expect(r.ready).toBe(false);
  });

  it("no plugins installed → plugins check fails, doors closed", () => {
    const r = probeReadiness({
      run: allToolsRun,
      homeDir: HOME,
      claude: CLAUDE_OK,
      existsFn: (p) => p === CANARY,
      readdirFn: () => [],
    });
    const plugins = r.checks.find((c) => c.key === "plugins");
    expect(plugins?.ok).toBe(false);
    expect(plugins?.detail).toBe("none installed");
    expect(r.ready).toBe(false);
  });

  it("plugins present but a DOOR-critical plugin (grade) missing → not ready, named", () => {
    const r = probeReadiness({
      run: allToolsRun,
      homeDir: HOME,
      claude: CLAUDE_OK,
      existsFn: (p) => p === CANARY,
      // adopt present, grade ABSENT — the Grade door would open into nothing.
      readdirFn: (p) => (p === CACHE_ROOT ? ["shipwright-adopt", "shipwright-build"] : []),
    });
    const plugins = r.checks.find((c) => c.key === "plugins");
    expect(plugins?.ok).toBe(false);
    expect(plugins?.detail).toMatch(/missing: .*shipwright-grade/);
    expect(r.ready).toBe(false);
  });

  it("shared/ canary missing → cache incoherent even with plugin dirs present", () => {
    const r = probeReadiness({
      run: allToolsRun,
      homeDir: HOME,
      claude: CLAUDE_OK,
      existsFn: () => false,
      readdirFn: (p) => (p === CACHE_ROOT ? ["shipwright-iterate"] : []),
    });
    const cache = r.checks.find((c) => c.key === "cache");
    expect(cache?.ok).toBe(false);
    expect(cache?.detail).toBe("shared/ missing");
    expect(r.ready).toBe(false);
  });

  it("unsupported Claude CLI → claude check fails with a need->= detail", () => {
    const r = probeReadiness({
      run: allToolsRun,
      homeDir: HOME,
      claude: { supported: false, raw: "1.2.0", minSupported: "2.0.0" },
      ...healthyFs(),
    });
    const claude = r.checks.find((c) => c.key === "claude");
    expect(claude?.ok).toBe(false);
    expect(claude?.detail).toMatch(/need >= 2\.0\.0/);
    expect(r.ready).toBe(false);
  });

  it("readdir throwing (cache root absent) is swallowed → plugins none installed", () => {
    const r = probeReadiness({
      run: allToolsRun,
      homeDir: HOME,
      claude: CLAUDE_OK,
      existsFn: () => false,
      readdirFn: () => {
        throw new Error("ENOENT");
      },
    });
    expect(r.checks.find((c) => c.key === "plugins")?.ok).toBe(false);
    expect(r.ready).toBe(false);
  });
});

describe("probe helpers", () => {
  it("extractVersion pulls the first x.y(.z) token", () => {
    expect(extractVersion("uv 0.5.11 (abc)")).toBe("0.5.11");
    expect(extractVersion("git version 2.47.1.windows.1")).toBe("2.47.1");
    expect(extractVersion("no digits")).toBe("");
  });

  it("compareVersions handles missing segments", () => {
    expect(compareVersions("3.13", "3.11.0")).toBe(1);
    expect(compareVersions("3.11", "3.11.0")).toBe(0);
    expect(compareVersions("3.9.7", "3.11.0")).toBe(-1);
  });

  it("resolvePython returns the first working interpreter, skipping failing ones", () => {
    const run: RunFn = (cmd) => (cmd === "python" ? okRun("3.12.4") : NOT_FOUND);
    expect(resolvePython(run)).toEqual({ bin: "python", version: "3.12.4" });
    expect(resolvePython(() => NOT_FOUND)).toBeNull();
  });
});
