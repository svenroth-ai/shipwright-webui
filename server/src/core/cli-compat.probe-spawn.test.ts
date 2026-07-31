/*
 * cli-compat — the Claude version probe must never ask for a platform shell.
 *
 * Run-ID: iterate-2026-07-31-win32-shell-spawn-remediation.
 *
 * Before this iterate the win32 branch was `spawn(`"${bin}"`, ["--version"],
 * { shell: true })` — the shell being the only way it could reach a `claude.cmd`
 * shim. It now routes through `resolveSpawn` (ADR-044 / preview-win32-spawn),
 * which locates the real file and invokes a shim through an explicit
 * `cmd.exe /d /s /c`. These pin the resulting argv.
 *
 * Cross-OS determinism: CI runs this suite on ubuntu, and `resolveSpawn`'s win32
 * branch is only reached when `process.platform` is stubbed — the same idiom (and
 * the same reason) as preview-win32-resolve.test.ts.
 *
 * What these CANNOT prove is that the argv actually starts a process on Windows.
 * That is process startup and is covered by real execution (AC-6).
 */
import { afterEach, describe, expect, it } from "vitest";
import type { spawnSync as SpawnSyncType } from "node:child_process";

import { probeClaudeVersion } from "./cli-compat.js";

const REAL_PLATFORM = process.platform;

function setPlatform(p: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: p, configurable: true });
}

afterEach(() => {
  setPlatform(REAL_PLATFORM);
});

interface Recorded {
  command: string;
  args: readonly string[];
  options: Record<string, unknown>;
}

/** A spawnSync stand-in that records its call and reports a version. */
function recorder(stdout = "2.1.200 (Claude Code)") {
  const calls: Recorded[] = [];
  const fake = ((command: string, args: readonly string[], options: Record<string, unknown>) => {
    calls.push({ command, args, options });
    return { stdout, stderr: "", status: 0, error: undefined };
  }) as unknown as typeof SpawnSyncType;
  return { calls, fake };
}

describe("probeClaudeVersion — never spawns through a platform shell", () => {
  it.each(["win32", "linux", "darwin"] as NodeJS.Platform[])(
    "passes shell:false on %s",
    (plat) => {
      setPlatform(plat);
      const { calls, fake } = recorder();
      probeClaudeVersion({ claudeBin: "/opt/claude/claude", spawnSync: fake });
      expect(calls).toHaveLength(1);
      expect(calls[0].options.shell).toBe(false);
    },
  );

  it("win32: an .exe binary is spawned DIRECTLY — no cmd.exe in the argv", () => {
    setPlatform("win32");
    const { calls, fake } = recorder();
    const bin = "C:\\Users\\x\\.local\\bin\\claude.exe";
    const info = probeClaudeVersion({ claudeBin: bin, spawnSync: fake });

    expect(calls[0].command).toBe(bin);
    expect(calls[0].args).toEqual(["--version"]);
    expect(calls[0].command.toLowerCase()).not.toContain("cmd.exe");
    // The quoting the old shell path needed is gone with the shell.
    expect(calls[0].command).not.toContain('"');
    expect(info.raw).toBe("2.1.200 (Claude Code)");
    expect(info.supported).toBe(true);
  });

  it("win32: a .cmd shim goes through an explicit `cmd /d /s /c`, discrete argv", () => {
    setPlatform("win32");
    const { calls, fake } = recorder();
    const bin = "C:\\npm\\claude.cmd";
    probeClaudeVersion({ claudeBin: bin, spawnSync: fake });

    expect(calls[0].command.toLowerCase()).toContain("cmd.exe");
    expect(calls[0].args).toEqual(["/d", "/s", "/c", bin, "--version"]);
    expect(calls[0].options.shell).toBe(false);
    expect(calls[0].options.windowsVerbatimArguments).toBeUndefined();
  });

  it("win32: a SPACED .cmd path takes the verbatim outer-quoted form", () => {
    setPlatform("win32");
    const { calls, fake } = recorder();
    probeClaudeVersion({ claudeBin: "C:\\Program Files\\npm\\claude.cmd", spawnSync: fake });

    expect(calls[0].args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(calls[0].args[3]).toBe('""C:\\Program Files\\npm\\claude.cmd" --version"');
    expect(calls[0].options.windowsVerbatimArguments).toBe(true);
  });

  it("POSIX stays a plain direct spawn of the resolved path", () => {
    setPlatform("linux");
    const { calls, fake } = recorder();
    probeClaudeVersion({ claudeBin: "/home/u/.local/bin/claude", spawnSync: fake });
    expect(calls[0].command).toBe("/home/u/.local/bin/claude");
    expect(calls[0].args).toEqual(["--version"]);
  });

  it("no resolvable binary → an honest 'unknown version', never a throw", () => {
    setPlatform("win32");
    const { calls, fake } = recorder();
    const info = probeClaudeVersion({ claudeBin: "", spawnSync: fake });
    expect(info).toEqual({ raw: "", parsed: null, supported: false });
    expect(calls).toHaveLength(0);
  });

  it("garbage on stdout is reported unsupported rather than crashing the boot probe", () => {
    setPlatform("win32");
    const { fake } = recorder("command not found");
    const info = probeClaudeVersion({ claudeBin: "C:\\npm\\claude.cmd", spawnSync: fake });
    expect(info.parsed).toBeNull();
    expect(info.supported).toBe(false);
  });
});
