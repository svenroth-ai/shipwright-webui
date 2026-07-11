import { describe, it, expect, vi } from "vitest";
import { EventEmitter } from "node:events";
import type { spawn as realSpawn } from "node:child_process";

import {
  drainStdio,
  treeKill,
  awaitExit,
} from "./preview-child-lifecycle.js";
import {
  PreviewSessionManager,
  PreviewExitedEarlyError,
} from "./preview-session-manager.js";

// A ChildProcess stub with REAL EventEmitter stdout/stderr so the drain path
// can attach listeners + we can push data through them. `pid` is settable so
// tree-kill's negative-pid group signal is assertable.
interface FakeChild {
  emit: EventEmitter["emit"];
  on: EventEmitter["on"];
  once: EventEmitter["once"];
  removeListener: EventEmitter["removeListener"];
  kill: ReturnType<typeof vi.fn>;
  stdout: EventEmitter;
  stderr: EventEmitter;
  pid: number;
  exitCode: number | null;
  killed: boolean;
  setExit(code: number | null): void;
}

function fakeChild(pid = 12345): FakeChild {
  const ev = new EventEmitter();
  const stdout = new EventEmitter();
  const stderr = new EventEmitter();
  const state = { exitCode: null as number | null, killed: false };
  const child = {
    emit: ev.emit.bind(ev),
    on: ev.on.bind(ev),
    once: ev.once.bind(ev),
    removeListener: ev.removeListener.bind(ev),
    kill: vi.fn((_sig?: NodeJS.Signals | number) => {
      state.killed = true;
      setImmediate(() => ev.emit("exit", 143));
      return true;
    }),
    stdout,
    stderr,
    pid,
    get exitCode() {
      return state.exitCode;
    },
    get killed() {
      return state.killed;
    },
    setExit(code: number | null) {
      state.exitCode = code;
    },
  };
  return child as unknown as FakeChild;
}

const flush = () => new Promise((r) => setTimeout(r, 0));

function baseProfile() {
  return {
    dev_server: {
      command: "npm run dev",
      port: 5173,
      ready_path: "/",
      ready_timeout_seconds: 5,
    },
  };
}

// Shared spawn-options builder — DRYs the injected seams across regressions.
type OptOverrides = Partial<Parameters<PreviewSessionManager["spawn"]>[2]>;
function opts(spawn: unknown, over: OptOverrides = {}) {
  return {
    cwd: "/tmp",
    spawn: spawn as never,
    probePort: async () => true,
    probeReady: async () => true,
    env: {},
    ...over,
  };
}

const profB = {
  dev_server: {
    command: "npm run start",
    port: 5174,
    ready_path: "/",
    ready_timeout_seconds: 5,
  },
};

describe("drainStdio (F11)", () => {
  it("attaches a `data` listener to stdout AND stderr so the OS pipe drains", () => {
    const child = fakeChild();
    drainStdio(child);
    expect(child.stdout.listenerCount("data")).toBeGreaterThanOrEqual(1);
    expect(child.stderr.listenerCount("data")).toBeGreaterThanOrEqual(1);
  });

  it("retains only a bounded tail of interleaved output", () => {
    const child = fakeChild();
    const d = drainStdio(child, 10);
    child.stdout.emit("data", Buffer.from("abcdefgh"));
    child.stderr.emit("data", Buffer.from("IJKLMNOP"));
    const tail = d.tail();
    expect(tail.length).toBeLessThanOrEqual(10);
    expect(tail.endsWith("IJKLMNOP")).toBe(true);
  });

  it("is a no-op on null streams (never throws)", () => {
    expect(drainStdio({ stdout: null, stderr: null }).tail()).toBe("");
  });
});

describe("treeKill (F13)", () => {
  it("POSIX: signals the whole process group via a negative pid", () => {
    const processKill = vi.fn();
    const child = fakeChild(4321);
    treeKill(child, "SIGTERM", { platform: "linux", processKill });
    expect(processKill).toHaveBeenCalledWith(-4321, "SIGTERM");
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("POSIX: falls back to a direct kill when the group signal throws", () => {
    const processKill = vi.fn(() => {
      throw new Error("ESRCH");
    });
    const child = fakeChild(4321);
    treeKill(child, "SIGTERM", { platform: "linux", processKill });
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("win32: spawns `taskkill /T /F` against the pid (kills cmd→npm→node)", () => {
    const killSpawn = vi.fn(() => ({ once: vi.fn() }));
    const child = fakeChild(9090);
    treeKill(child, "SIGTERM", {
      platform: "win32",
      killSpawn: killSpawn as unknown as typeof realSpawn,
    });
    expect(killSpawn).toHaveBeenCalledTimes(1);
    const [cmd, args, options] = killSpawn.mock.calls[0] as unknown as [
      string,
      string[],
      { shell?: unknown },
    ];
    expect(cmd).toBe("taskkill");
    expect(args).toEqual(["/pid", "9090", "/t", "/f"]);
    expect(options.shell).toBe(false);
    expect(child.kill).not.toHaveBeenCalled();
  });

  it("falls back to a direct kill when there is no usable pid", () => {
    const processKill = vi.fn();
    const child = fakeChild(0);
    treeKill(child, "SIGTERM", { platform: "linux", processKill });
    expect(processKill).not.toHaveBeenCalled();
    expect(child.kill).toHaveBeenCalledWith("SIGTERM");
  });
});

describe("awaitExit (F13)", () => {
  it("resolves immediately when the child has already exited", async () => {
    const child = fakeChild();
    child.setExit(0);
    await expect(awaitExit(child, 1000)).resolves.toBeUndefined();
  });

  it("resolves when the child later emits `exit`", async () => {
    const child = fakeChild();
    const p = awaitExit(child, 1000);
    setImmediate(() => child.emit("exit", 0));
    await expect(p).resolves.toBeUndefined();
  });

  it("resolves after the timeout even if `exit` never fires (bounded)", async () => {
    vi.useFakeTimers();
    const child = fakeChild();
    const p = awaitExit(child, 50);
    await vi.advanceTimersByTimeAsync(60);
    await expect(p).resolves.toBeUndefined();
    vi.useRealTimers();
  });
});

describe("PreviewSessionManager — child lifecycle regressions (D20)", () => {
  it("F12: concurrent spawn() for one project coalesces onto a single child", async () => {
    const mgr = new PreviewSessionManager();
    const spawn = vi.fn(() => fakeChild() as unknown);
    const o = opts(spawn);
    const [a, b] = await Promise.all([
      mgr.spawn("p1", baseProfile(), o),
      mgr.spawn("p1", baseProfile(), o),
    ]);
    // Pre-fix: two spawns → an untracked orphan killAll() can never reach.
    expect(spawn).toHaveBeenCalledTimes(1);
    expect(b.sessionId).toBe(a.sessionId);
    expect(mgr.size()).toBe(1);
  });

  it("F12: a different-profile concurrent spawn serializes + tree-kills the old child", async () => {
    const pool = [fakeChild(11), fakeChild(22)];
    const spawn = vi.fn(() => pool.shift() as unknown);
    const processKill = vi.fn();
    const mgr = new PreviewSessionManager({
      platform: "linux",
      processKill,
      awaitExitMs: 5,
    });
    const [a, b] = await Promise.all([
      mgr.spawn("p1", baseProfile(), opts(spawn)),
      mgr.spawn("p1", profB, opts(spawn)),
    ]);
    // Pre-fix: profB spawns concurrently and orphans child 11 (never killed).
    expect(processKill).toHaveBeenCalledWith(-11, "SIGTERM");
    expect(mgr.size()).toBe(1);
    expect(b.profileHash).not.toBe(a.profileHash);
  });

  it("F11: spawn drains stdout/stderr so a full pipe can't freeze the child", async () => {
    const child = fakeChild();
    const mgr = new PreviewSessionManager();
    await mgr.spawn("p1", baseProfile(), opts(() => child));
    expect(child.stdout.listenerCount("data")).toBeGreaterThanOrEqual(1);
    expect(child.stderr.listenerCount("data")).toBeGreaterThanOrEqual(1);
  });

  it("F11: an early-exit error carries the captured stderr tail", async () => {
    const child = fakeChild();
    const mgr = new PreviewSessionManager();
    const p = mgr.spawn(
      "p1",
      baseProfile(),
      opts(() => child, { probeReady: async () => false }),
    );
    await flush();
    child.stderr.emit("data", Buffer.from("Error: boot failed on port 5173"));
    child.emit("exit", 1);
    // Capture the rejection once, then assert type AND tail on the same object.
    const err = await p.then(() => null, (e: unknown) => e);
    expect(err).toBeInstanceOf(PreviewExitedEarlyError);
    expect((err as PreviewExitedEarlyError).tail).toContain("boot failed");
  });

  it("F13: killAll tree-kills tracked children (POSIX process group)", async () => {
    const processKill = vi.fn();
    const mgr = new PreviewSessionManager({ platform: "linux", processKill });
    const child = fakeChild(2222);
    await mgr.spawn("p1", baseProfile(), opts(() => child));
    expect(mgr.size()).toBe(1);
    mgr.killAll();
    expect(processKill).toHaveBeenCalledWith(-2222, "SIGTERM");
    expect(mgr.size()).toBe(0);
  });

  it("F13: a profile-change respawn waits for the old child to exit before probing", async () => {
    const oldChild = fakeChild(3333);
    const pool = [oldChild, fakeChild(4444)];
    const spawn = vi.fn(() => pool.shift() as unknown);
    let oldExited = false;
    oldChild.once("exit", () => {
      oldExited = true;
    });
    // Simulate the process group dying async once treeKill signals it.
    const processKill = vi.fn(() =>
      setImmediate(() => oldChild.emit("exit", 143)),
    );
    const mgr = new PreviewSessionManager({
      platform: "linux",
      processKill,
      awaitExitMs: 1000,
    });

    await mgr.spawn("p1", baseProfile(), opts(spawn));

    let portProbedAfterExit: boolean | null = null;
    const probePortB = vi.fn(async () => {
      portProbedAfterExit = oldExited;
      return true;
    });
    await mgr.spawn("p1", profB, opts(spawn, { probePort: probePortB }));

    expect(processKill).toHaveBeenCalledWith(-3333, "SIGTERM");
    // Pre-fix: the new port probe races the un-awaited kill → observes false.
    expect(portProbedAfterExit).toBe(true);
  });
});
