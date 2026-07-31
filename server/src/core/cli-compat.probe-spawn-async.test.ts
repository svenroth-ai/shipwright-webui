/*
 * cli-compat — the ASYNC Claude version probe must not ask for a platform shell.
 *
 * Run-ID: iterate-2026-07-31-win32-shell-spawn-remediation.
 *
 * WHY A SECOND FILE. `cli-compat.probe-spawn.test.ts` covers the SYNC probe by
 * injecting `spawnSync` through `ClaudeVersionProbeDeps`. The async probe has no
 * such seam — it calls the module-scope `spawn` — so it needs `vi.mock`, and
 * mocking `node:child_process` for the whole module would disturb the sync
 * suite's injected-dep story. Keeping the mock in its own file keeps both honest.
 *
 * WHY IT EXISTS AT ALL: external code review on this iterate pointed out that a
 * regression restoring `shell: true`, dropping `windowsVerbatimArguments`, or
 * using the wrong plan in ONLY the async probe would have passed the suite. That
 * is exactly the failure mode this whole iterate is about — fixing the flagged
 * branch and leaving its unflagged twin — so it gets a guard.
 */
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { EventEmitter } from "node:events";

interface RecordedSpawn {
  command: string;
  args: readonly string[];
  options: Record<string, unknown>;
}

const h = vi.hoisted(() => ({
  calls: [] as RecordedSpawn[],
  stdout: "2.1.200 (Claude Code)",
  emitError: false,
}));

vi.mock("node:child_process", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:child_process")>();
  return {
    ...actual,
    spawn: (command: string, args: readonly string[], options: Record<string, unknown>) => {
      h.calls.push({ command, args, options });
      const child = new EventEmitter() as EventEmitter & { stdout: EventEmitter };
      child.stdout = new EventEmitter();
      queueMicrotask(() => {
        if (h.emitError) {
          child.emit("error", new Error("spawn failed"));
          return;
        }
        child.stdout.emit("data", Buffer.from(h.stdout, "utf-8"));
        child.emit("close", 0);
      });
      return child;
    },
  };
});

const { probeClaudeVersionAsync } = await import("./cli-compat.js");

const REAL_PLATFORM = process.platform;

function setPlatform(p: NodeJS.Platform) {
  Object.defineProperty(process, "platform", { value: p, configurable: true });
}

beforeEach(() => {
  h.calls.length = 0;
  h.stdout = "2.1.200 (Claude Code)";
  h.emitError = false;
});

afterEach(() => {
  setPlatform(REAL_PLATFORM);
});

describe("probeClaudeVersionAsync — never spawns through a platform shell", () => {
  it.each(["win32", "linux", "darwin"] as NodeJS.Platform[])(
    "passes shell:false on %s",
    async (plat) => {
      setPlatform(plat);
      await probeClaudeVersionAsync({ claudeBin: "/opt/claude/claude" });
      expect(h.calls).toHaveLength(1);
      expect(h.calls[0].options.shell).toBe(false);
    },
  );

  it("win32: an .exe binary is spawned DIRECTLY — no cmd.exe, no manual quoting", async () => {
    setPlatform("win32");
    const bin = "C:\\Users\\x\\.local\\bin\\claude.exe";
    const info = await probeClaudeVersionAsync({ claudeBin: bin });
    expect(h.calls[0].command).toBe(bin);
    expect(h.calls[0].args).toEqual(["--version"]);
    expect(h.calls[0].command).not.toContain('"');
    expect(info.raw).toBe("2.1.200 (Claude Code)");
    expect(info.supported).toBe(true);
  });

  it("win32: a .cmd shim goes through an explicit `cmd /d /s /c`, discrete argv", async () => {
    setPlatform("win32");
    const bin = "C:\\npm\\claude.cmd";
    await probeClaudeVersionAsync({ claudeBin: bin });
    expect(h.calls[0].command.toLowerCase()).toContain("cmd.exe");
    expect(h.calls[0].args).toEqual(["/d", "/s", "/c", bin, "--version"]);
    expect(h.calls[0].options.windowsVerbatimArguments).toBeUndefined();
  });

  it("win32: a SPACED .cmd path takes the verbatim outer-quoted form", async () => {
    setPlatform("win32");
    await probeClaudeVersionAsync({ claudeBin: "C:\\Program Files\\npm\\claude.cmd" });
    expect(h.calls[0].args.slice(0, 3)).toEqual(["/d", "/s", "/c"]);
    expect(h.calls[0].args[3]).toBe('""C:\\Program Files\\npm\\claude.cmd" --version"');
    expect(h.calls[0].options.windowsVerbatimArguments).toBe(true);
  });

  it("POSIX stays a plain direct spawn of the resolved path", async () => {
    setPlatform("linux");
    await probeClaudeVersionAsync({ claudeBin: "/home/u/.local/bin/claude" });
    expect(h.calls[0].command).toBe("/home/u/.local/bin/claude");
    expect(h.calls[0].args).toEqual(["--version"]);
  });

  it("a spawn error resolves to an honest 'unknown version', never a rejection", async () => {
    setPlatform("win32");
    h.emitError = true;
    await expect(
      probeClaudeVersionAsync({ claudeBin: "C:\\npm\\claude.cmd" }),
    ).resolves.toEqual({ raw: "", parsed: null, supported: false });
  });

  it("no resolvable binary → unknown version, and nothing is spawned", async () => {
    setPlatform("win32");
    const info = await probeClaudeVersionAsync({ claudeBin: "" });
    expect(info).toEqual({ raw: "", parsed: null, supported: false });
    expect(h.calls).toHaveLength(0);
  });

  it("garbage on stdout is graded unsupported rather than crashing the caller", async () => {
    setPlatform("win32");
    h.stdout = "command not found";
    const info = await probeClaudeVersionAsync({ claudeBin: "C:\\npm\\claude.cmd" });
    expect(info.parsed).toBeNull();
    expect(info.supported).toBe(false);
  });

  it("agrees with the sync probe's plan for the same binary", async () => {
    setPlatform("win32");
    await probeClaudeVersionAsync({ claudeBin: "C:\\npm\\claude.cmd" });
    // Same argv the sync suite pins — the two probes must not drift apart.
    expect(h.calls[0].args).toEqual(["/d", "/s", "/c", "C:\\npm\\claude.cmd", "--version"]);
  });
});
