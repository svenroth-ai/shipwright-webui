import { describe, it, expect, vi, afterEach } from "vitest";
import { EventEmitter } from "node:events";
import type { ChildProcess, spawn as realSpawn } from "node:child_process";

import { createCliChildSpawn, killAllTrackedCliChildren } from "./cli-child-spawn.js";

/*
 * Required-CI PR-review finding on PR #466: the old per-file
 * `execFile(..., { timeout })` implementations only killed the immediate
 * `uv` child on timeout, never a grandchild `uv run` had already forked —
 * a Windows-specific leak whose exposure jumped once codex-oracle-runner.ts
 * started calling this every 60s per stalled task. These tests prove the
 * NEW behaviour: a real process TREE dies on timeout (not just the direct
 * child), the tree-kill goes around `child.kill()` entirely (so a naive
 * `error.killed` check would have missed it — that's the bug this fixes),
 * and the shutdown registry tracks/untracks correctly.
 */

function fakeChild(pid = 4242) {
  return Object.assign(new EventEmitter(), {
    pid,
    kill: vi.fn(() => true),
    stdout: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
    stderr: Object.assign(new EventEmitter(), { setEncoding: vi.fn() }),
  }) as unknown as ChildProcess & { kill: ReturnType<typeof vi.fn> };
}

describe("createCliChildSpawn — normal completion", () => {
  it("resolves code 0 with captured stdout on a clean exit", async () => {
    const child = fakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof realSpawn;
    const spawnCli = createCliChildSpawn({ spawnFn, platform: "linux" });
    const p = spawnCli("bin", ["a"], { timeoutMs: 5000, env: {} });
    child.stdout!.emit("data", "hello");
    child.emit("close", 0);
    await expect(p).resolves.toEqual({ code: 0, stdout: "hello", stderr: "" });
  });

  it("resolves the process's own non-zero exit code, no spawnError", async () => {
    const child = fakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof realSpawn;
    const spawnCli = createCliChildSpawn({ spawnFn, platform: "linux" });
    const p = spawnCli("bin", [], { timeoutMs: 5000, env: {} });
    child.stderr!.emit("data", "boom");
    child.emit("close", 3);
    await expect(p).resolves.toEqual({ code: 3, stdout: "", stderr: "boom" });
  });

  it("resolves code -1 with the spawn error code on ENOENT", async () => {
    const child = fakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof realSpawn;
    const spawnCli = createCliChildSpawn({ spawnFn, platform: "linux" });
    const p = spawnCli("missing-bin", [], { timeoutMs: 5000, env: {} });
    child.emit("error", Object.assign(new Error("not found"), { code: "ENOENT" }));
    await expect(p).resolves.toEqual({ code: -1, stdout: "", stderr: "", spawnError: "ENOENT" });
  });
});

describe("createCliChildSpawn — spawn/kill platform agreement", () => {
  it("spawns detached on POSIX (group leader, so treeKill's kill(-pid) can reach it)", () => {
    const child = fakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof realSpawn;
    createCliChildSpawn({ spawnFn, platform: "linux" })("bin", [], { timeoutMs: 1000, env: {} });
    expect(spawnFn).toHaveBeenCalledWith("bin", [], expect.objectContaining({ detached: true }));
  });

  it("does NOT spawn detached on win32 — taskkill /t walks Windows' own parent-child tracking", () => {
    const child = fakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof realSpawn;
    createCliChildSpawn({ spawnFn, platform: "win32" })("bin", [], { timeoutMs: 1000, env: {} });
    expect(spawnFn).toHaveBeenCalledWith("bin", [], expect.objectContaining({ detached: false }));
  });
});

describe("createCliChildSpawn — timeout drives a tree-kill, not child.kill()", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("tree-kills the whole process on timeout and reports code 124 — never calls child.kill() directly", async () => {
    vi.useFakeTimers();
    const child = fakeChild(9999);
    const spawnFn = vi.fn(() => child) as unknown as typeof realSpawn;
    const treeKillFn = vi.fn();
    const spawnCli = createCliChildSpawn({ spawnFn, treeKillFn, platform: "linux" });
    const p = spawnCli("bin", [], { timeoutMs: 1000, env: {} });

    await vi.advanceTimersByTimeAsync(1000);
    expect(treeKillFn).toHaveBeenCalledWith(child, "SIGKILL", { platform: "linux" });
    expect(child.kill).not.toHaveBeenCalled();

    // The kill eventually produces a real close event, which is what
    // resolves the promise — the timer alone is not the resolution.
    child.emit("close", null);
    await expect(p).resolves.toEqual({ code: 124, stdout: "", stderr: "", spawnError: "timeout" });
  });

  it("does not tree-kill a process that completes before the timeout fires", async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const spawnFn = vi.fn(() => child) as unknown as typeof realSpawn;
    const treeKillFn = vi.fn();
    const spawnCli = createCliChildSpawn({ spawnFn, treeKillFn, platform: "linux" });
    const p = spawnCli("bin", [], { timeoutMs: 5000, env: {} });
    child.emit("close", 0);
    await p;
    await vi.advanceTimersByTimeAsync(5000);
    expect(treeKillFn).not.toHaveBeenCalled();
  });
});

describe("killAllTrackedCliChildren — shutdown registry", () => {
  it("tree-kills every in-flight child and untracks it (second call is a no-op)", async () => {
    const child = fakeChild(555555);
    const spawnFn = vi.fn(() => child) as unknown as typeof realSpawn;
    const treeKillFn = vi.fn();
    const spawnCli = createCliChildSpawn({ spawnFn, treeKillFn, platform: "linux" });
    const p = spawnCli("bin", [], { timeoutMs: 30_000, env: {} });

    killAllTrackedCliChildren(treeKillFn);
    expect(treeKillFn).toHaveBeenCalledWith(child, "SIGKILL");

    treeKillFn.mockClear();
    killAllTrackedCliChildren(treeKillFn);
    expect(treeKillFn).not.toHaveBeenCalled();

    child.emit("close", null);
    await p;
  });

  it("a completed child is already untracked — killAllTrackedCliChildren leaves it alone", async () => {
    const child = fakeChild(7);
    const spawnFn = vi.fn(() => child) as unknown as typeof realSpawn;
    const treeKillFn = vi.fn();
    const spawnCli = createCliChildSpawn({ spawnFn, platform: "linux" });
    const p = spawnCli("bin", [], { timeoutMs: 30_000, env: {} });
    child.emit("close", 0);
    await p;

    killAllTrackedCliChildren(treeKillFn);
    expect(treeKillFn).not.toHaveBeenCalled();
  });
});

describe("createCliChildSpawn — real process-tree integration (no uv/python needed)", () => {
  it("a real timeout tree-kills a hanging child AND its already-forked grandchild", async () => {
    const spawnCli = createCliChildSpawn();
    // The child spawns a grandchild that spins forever, prints its pid,
    // then spins forever itself — proves the kill reaches BOTH generations,
    // not just the direct `uv`-equivalent child.
    const script = [
      "const { spawn } = require('node:child_process');",
      "const gc = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore' });",
      "process.stdout.write(String(gc.pid));",
      "setInterval(() => {}, 1000);",
    ].join("\n");

    const result = await spawnCli(process.execPath, ["-e", script], {
      timeoutMs: 800,
      env: process.env as NodeJS.ProcessEnv,
    });

    expect(result.code).toBe(124);
    expect(result.spawnError).toBe("timeout");
    const grandchildPid = Number(result.stdout.trim());
    expect(Number.isInteger(grandchildPid)).toBe(true);

    // process.kill(pid, 0) is a liveness probe (no signal actually sent) —
    // it throws ESRCH once the pid is truly gone. Windows resolves this
    // through libuv, which reports the same "no such process" outcome.
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect(() => process.kill(grandchildPid, 0)).toThrow();
  }, 15_000);
});
