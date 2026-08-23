/*
 * readiness-probe-run unit tests (FR-01.51) — the probe RUNNER + version-parsing
 * primitives, split from readiness-probe.ts. `defaultRun` is exercised against
 * real binaries (node present, a bogus name absent) so the exit-CODE contract the
 * uv python-find gate depends on is proven, not assumed.
 */

import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

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

  // @covers FR-01.51 — the bug fix: a tool present ONLY in ~/.local/bin (off the
  // process PATH) is found because defaultRun augments the lookup PATH. Proven on
  // POSIX with a fake executable; this is the exact Mac cold-start scenario.
  it.skipIf(process.platform === "win32")(
    "finds a binary installed in ~/.local/bin even when it is NOT on the process PATH",
    async () => {
      const home = mkdtempSync(path.join(os.tmpdir(), "probe-home-"));
      const localBin = path.join(home, ".local", "bin");
      mkdirSync(localBin, { recursive: true });
      const tool = path.join(localBin, "faketool");
      writeFileSync(tool, "#!/bin/sh\necho faketool 1.2.3\n");
      chmodSync(tool, 0o755);

      // A minimal PATH that deliberately EXCLUDES ~/.local/bin — pre-fix ENOENT.
      const r = await defaultRun("faketool", ["--version"], {
        platform: process.platform,
        homedir: home,
        env: { PATH: "/usr/bin:/bin" },
      });
      expect(r.ok).toBe(true);
      expect(r.code).toBe(0);
      expect(r.stdout + r.stderr).toContain("1.2.3");
    },
  );

  // @covers FR-01.51 — the WINDOWS arm of the same fix. On win32 defaultRun does
  // NOT resolvePosixBin; it relies on execFile honouring `options.env.PATH` to
  // locate the .exe. That is safe because libuv's Windows search_path reads PATH
  // from the CHILD env block (unlike POSIX execvp, which uses the parent environ)
  // — this test PROVES it end-to-end: a real .exe present only in %USERPROFILE%\
  // .local\bin, with a process PATH that excludes it, is found via the augmented
  // env. Copies node.exe as the fake tool (a genuine, runnable Windows binary).
  it.skipIf(process.platform !== "win32")(
    "finds a .exe in %USERPROFILE%\\.local\\bin even when it is NOT on the process PATH",
    async () => {
      const home = mkdtempSync(path.join(os.tmpdir(), "probe-home-win-"));
      const localBin = path.join(home, ".local", "bin");
      mkdirSync(localBin, { recursive: true });
      const tool = path.join(localBin, "faketool.exe");
      copyFileSync(process.execPath, tool); // a real, runnable .exe

      const r = await defaultRun("faketool", ["--version"], {
        platform: process.platform,
        homedir: home,
        // Minimal PATH that EXCLUDES ~/.local/bin; SystemRoot kept so the child boots.
        env: { PATH: "C:\\Windows\\System32", SystemRoot: process.env.SystemRoot },
      });
      expect(r.ok).toBe(true);
      expect(r.code).toBe(0);
    },
  );
});
