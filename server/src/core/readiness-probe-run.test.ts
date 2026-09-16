/*
 * readiness-probe-run unit tests (FR-01.51) — the probe RUNNER + version-parsing
 * primitives, split from readiness-probe.ts. `defaultRun` is exercised against
 * real binaries (node present, a bogus name absent) so the exit-CODE contract the
 * uv python-find gate depends on is proven, not assumed.
 */

import { chmodSync, copyFileSync, mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, it, expect, vi } from "vitest";

import {
  compareVersions,
  defaultRun,
  defaultRunShim,
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

describe("defaultRunShim — Windows .cmd/.bat PATH-shim probe", () => {
  const REAL_PLATFORM = process.platform;
  function setPlatform(p: NodeJS.Platform): void {
    Object.defineProperty(process, "platform", { value: p, configurable: true });
  }

  // @covers FR-01.51 — win32-branch coverage that holds on EVERY host (CI runs
  // this suite on ubuntu, so the `it.skipIf(win32)` tests above never execute
  // there): `process.platform` is stubbed the same way win32-spawn.test.ts
  // stubs it, so `resolveSpawn`'s own internal platform read (it has no
  // override param — see win32-spawn.ts) also takes the win32 branch.
  it("under a forced win32 platform, reports not-found (no execFile attempt) when resolveSpawn cannot place the name on PATH", async () => {
    setPlatform("win32");
    vi.stubEnv("PATH", "");
    try {
      const r = await defaultRunShim("shipwright-no-such-shim-xyz", ["--version"]);
      expect(r.ok).toBe(false);
      expect(r.code).toBeNull();
    } finally {
      vi.unstubAllEnvs();
      setPlatform(REAL_PLATFORM);
    }
  });

  // @covers FR-01.51 — win32-branch coverage for the execFile call itself
  // (the other half of the CI-host gap above). Resolves to a bare name whose
  // PATHEXT match carries an EXECUTABLE extension (`.exe`/`.com`), so
  // `resolveSpawn` returns the resolved path directly (win32CmdWrap's
  // fabricated cmd.exe path is the SHIM branch, not exercised here — it is
  // already covered end-to-end on real Windows by the `.cmd` test above).
  // The planted "executable" is a real, runnable file on whichever OS this
  // actually runs on, so the assertion holds on both hosts — same technique
  // as the `~/.local/bin` tests earlier in this file.
  it("under a forced win32 platform, resolves and runs a bare name via an executable-extension PATH match", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "shim-exe-probe-"));
    const tool = path.join(dir, "fakecodex.exe");
    if (REAL_PLATFORM === "win32") {
      copyFileSync(process.execPath, tool); // a real, runnable Windows .exe
    } else {
      writeFileSync(tool, "#!/bin/sh\necho fakecodex 7.7.7\n");
      chmodSync(tool, 0o755); // extension is cosmetic on POSIX; the shebang runs
    }
    setPlatform("win32");
    vi.stubEnv("PATH", `${dir};${process.env.PATH ?? ""}`);
    vi.stubEnv("PATHEXT", ".exe");
    try {
      const r = await defaultRunShim("fakecodex", ["--version"]);
      expect(r.ok).toBe(true);
      if (REAL_PLATFORM !== "win32") {
        expect(r.stdout + r.stderr).toContain("7.7.7");
      }
    } finally {
      vi.unstubAllEnvs();
      setPlatform(REAL_PLATFORM);
    }
  });

  // @covers FR-01.51 — the codex_cli_not_found bug: defaultRun cannot spawn a
  // .cmd shim on Windows (execFile shell:false + CVE-2024-27980 hardening →
  // spawn ENOENT even when the tool is genuinely installed, because a .cmd has
  // no matching .exe for CreateProcess to launch directly). defaultRunShim
  // resolves it via win32-spawn's resolveSpawn (ADR-044) first, then runs the
  // resolved cmd.exe-wrapped command. This reproduces the exact reported bug
  // (a real, runnable .cmd shim on PATH) and proves the fix against it.
  it.skipIf(process.platform !== "win32")(
    "resolves and runs a .cmd PATH shim that defaultRun cannot spawn directly",
    async () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), "shim-probe-"));
      const shim = path.join(dir, "fakecodex.cmd");
      writeFileSync(shim, "@echo off\r\necho fakecodex 9.9.9\r\n");
      // vi.stubEnv (not a raw process.env.PATH assignment) — Vitest's own
      // env-stubbing primitive, restored via vi.unstubAllEnvs() below.
      vi.stubEnv("PATH", `${dir};${process.env.PATH ?? ""}`);
      try {
        const viaShim = await defaultRunShim("fakecodex", ["--version"]);
        expect(viaShim.ok).toBe(true);
        expect(viaShim.stdout + viaShim.stderr).toContain("9.9.9");

        // Proves this IS the regression under test: the un-fixed defaultRun
        // path fails on the identical shim, exactly like the reported bug.
        const viaDefaultRun = await defaultRun("fakecodex", ["--version"]);
        expect(viaDefaultRun.ok).toBe(false);
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );

  // @covers FR-01.51 — a genuine .exe on PATH still resolves and runs directly
  // (no cmd.exe wrap needed); the shim resolver is a superset, not a detour.
  it.skipIf(process.platform !== "win32")("still runs a real .exe on PATH", async () => {
    const r = await defaultRunShim("node", ["--version"]);
    expect(r.ok).toBe(true);
  });

  // @covers FR-01.51 — a name absent from PATH entirely reports not-found
  // (RunResult), never an unhandled throw or rejection.
  it.skipIf(process.platform !== "win32")(
    "reports not-found for a name absent from PATH, without throwing",
    async () => {
      const r = await defaultRunShim("shipwright-no-such-shim-xyz", ["--version"]);
      expect(r.ok).toBe(false);
      expect(r.code).toBeNull();
    },
  );

  // @covers FR-01.51 — POSIX has no .cmd/.bat shim concept: defaultRunShim is
  // a pure pass-through to defaultRun there (execvp already resolves a shim
  // script by bare name).
  it.skipIf(process.platform === "win32")("is a pass-through to defaultRun on POSIX", async () => {
    const viaShim = await defaultRunShim("node", ["--version"]);
    const viaDefault = await defaultRun("node", ["--version"]);
    expect(viaShim.ok).toBe(true);
    expect(viaShim.ok).toBe(viaDefault.ok);
  });
});
