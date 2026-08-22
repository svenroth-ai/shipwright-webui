/*
 * readiness-probe-run unit tests (FR-01.51) — the probe RUNNER + version-parsing
 * primitives, split from readiness-probe.ts. `defaultRun` is exercised against
 * real binaries (node present, a bogus name absent) so the exit-CODE contract the
 * uv python-find gate depends on is proven, not assumed.
 */

import { describe, it, expect } from "vitest";

import {
  compareVersions,
  defaultRun,
  extractVersion,
  resolvePython,
  type RunFn,
  type RunResult,
} from "./readiness-probe-run.js";

function okRun(version: string): RunResult {
  return { ok: true, stdout: `tool ${version}`, stderr: "", code: 0 };
}
const NOT_FOUND: RunResult = { ok: false, stdout: "", stderr: "", code: null };

describe("probe helpers", () => {
  // @covers FR-01.51
  it("extractVersion pulls the first x.y(.z) token", () => {
    expect(extractVersion("uv 0.5.11 (abc)")).toBe("0.5.11");
    expect(extractVersion("git version 2.47.1.windows.1")).toBe("2.47.1");
    expect(extractVersion("no digits")).toBe("");
  });

  // @covers FR-01.51
  it("compareVersions handles missing segments", () => {
    expect(compareVersions("3.13", "3.11.0")).toBe(1);
    expect(compareVersions("3.11", "3.11.0")).toBe(0);
    expect(compareVersions("3.9.7", "3.11.0")).toBe(-1);
  });

  // @covers FR-01.51
  it("resolvePython returns the first working interpreter, skipping failing ones", async () => {
    const run: RunFn = async (cmd) => (cmd === "python" ? okRun("3.12.4") : NOT_FOUND);
    expect(await resolvePython(run)).toEqual({ bin: "python", version: "3.12.4" });
    expect(await resolvePython(async () => NOT_FOUND)).toBeNull();
  });

  // @covers FR-01.51
  it("defaultRun reports a real exit code: 0 for a working tool, null for a missing binary", async () => {
    // node is always present; the code-gate depends on this being a REAL exit code.
    const good = await defaultRun("node", ["--version"]);
    expect(good.ok).toBe(true);
    expect(good.code).toBe(0);
    const bad = await defaultRun("shipwright-no-such-binary-xyz", ["--version"]);
    expect(bad.ok).toBe(false);
    expect(bad.code).toBeNull();
  });
});
