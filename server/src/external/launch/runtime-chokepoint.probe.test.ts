/*
 * runtime-chokepoint.probe.test.ts — the REAL (unmocked) `isCodexCliAvailable`
 * probe. Split from runtime-chokepoint.test.ts to keep both files ≤ 300 LOC.
 */
import { chmodSync, copyFileSync, mkdtempSync, writeFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

import { describe, expect, it, vi } from "vitest";

import { isCodexCliAvailable } from "./runtime-chokepoint.js";
import { defaultRunShim } from "../../core/readiness-probe-run.js";

describe("isCodexCliAvailable — the real (unmocked) probe", () => {
  const REAL_PLATFORM = process.platform;
  function setPlatform(p: NodeJS.Platform): void {
    Object.defineProperty(process, "platform", { value: p, configurable: true });
  }

  // @covers FR-01.51 — the `it.skipIf(win32)` test below never runs on CI
  // (ubuntu), so `isCodexCliAvailable`'s one line is otherwise never executed
  // there. `process.platform` is stubbed the same way win32-spawn.test.ts
  // stubs it, so this holds on every host — same executable-extension
  // technique as `defaultRunShim`'s own host-independent test.
  it("under a forced win32 platform, finds and runs a real codex PATH match", async () => {
    const dir = mkdtempSync(path.join(os.tmpdir(), "codex-exe-probe-"));
    const tool = path.join(dir, "codex.exe");
    if (REAL_PLATFORM === "win32") {
      copyFileSync(process.execPath, tool); // a real, runnable Windows .exe
    } else {
      writeFileSync(tool, "#!/bin/sh\necho codex 5.5.5-host-independent-probe\n");
      chmodSync(tool, 0o755); // extension is cosmetic on POSIX; the shebang runs
    }
    setPlatform("win32");
    vi.stubEnv("PATH", `${dir};${process.env.PATH ?? ""}`);
    vi.stubEnv("PATHEXT", ".exe");
    try {
      expect(await isCodexCliAvailable()).toBe(true);
    } finally {
      vi.unstubAllEnvs();
      setPlatform(REAL_PLATFORM);
    }
  });

  // @covers FR-01.51 — regression proof for the codex_cli_not_found Windows
  // bug (iterate-2026-09-16-codex-probe-win32-shim): Codex CLI installs as a
  // `.cmd` PATH shim on Windows (no `codex.exe`); the real probe must find
  // and run it, not just a mocked seam. Runs the ACTUAL function (no
  // `checkCodexCliAvailable` override) against a real, runnable fake shim.
  it.skipIf(process.platform !== "win32")(
    "finds and runs a real .cmd Codex shim on PATH",
    async () => {
      const dir = mkdtempSync(path.join(os.tmpdir(), "codex-shim-"));
      const shim = path.join(dir, "codex.cmd");
      // A version token unlikely to match any real Codex CLI, so a passing
      // assertion below can only be explained by THIS fake shim having run —
      // not a real `codex` elsewhere on the host's PATH.
      writeFileSync(shim, "@echo off\r\necho codex 999.999.999-fake-shim-probe\r\n");
      // vi.stubEnv (not a raw process.env.PATH assignment) — Vitest's own
      // env-stubbing primitive, restored via vi.unstubAllEnvs() below.
      vi.stubEnv("PATH", `${dir};${process.env.PATH ?? ""}`);
      try {
        expect(await isCodexCliAvailable()).toBe(true);
        // isCodexCliAvailable only surfaces a boolean; corroborate via the
        // same underlying probe (identical PATH state) that the version
        // string resolved is THIS shim's, not an incidental real install.
        const raw = await defaultRunShim("codex", ["--version"]);
        expect(raw.stdout + raw.stderr).toContain("999.999.999-fake-shim-probe");
      } finally {
        vi.unstubAllEnvs();
      }
    },
  );
});
