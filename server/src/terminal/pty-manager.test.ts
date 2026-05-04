/*
 * pty-manager.test.ts — unit tests for the embedded-terminal pty manager.
 *
 * The real pty backend (node-pty-prebuilt-multiarch) is replaced with an
 * in-memory FakePty here so the tests stay deterministic and don't pull
 * in a native binary. All tests assert on observable behaviour
 * (subscribe receives data, kill calls .kill, idle timeout fires .kill,
 * writer-ownership is bound to the WS conn identity) rather than on
 * internal state, per /shipwright-iterate's TDD AC contract.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  PtyManager,
  PtySpawnRejectedError,
  quotePathForShell,
  type PtySpawnFn,
  type PtyHandleApi,
} from "./pty-manager.js";

// ---------------------------------------------------------------------------
// FakePty — in-memory stand-in for IPty from node-pty-prebuilt-multiarch.
// ---------------------------------------------------------------------------

interface FakePty extends PtyHandleApi {
  __writes: string[];
  __resizes: Array<{ cols: number; rows: number }>;
  __killed: boolean;
  __emit(data: string): void;
  __exit(exitCode: number, signal?: number): void;
}

function createFakePty(): FakePty {
  const dataListeners: Array<(s: string) => void> = [];
  const exitListeners: Array<(e: { exitCode: number; signal?: number }) => void> = [];
  const fake: FakePty = {
    __writes: [],
    __resizes: [],
    __killed: false,
    onData(cb) {
      dataListeners.push(cb);
      return { dispose() { /* noop */ } };
    },
    onExit(cb) {
      exitListeners.push(cb);
      return { dispose() { /* noop */ } };
    },
    write(data) {
      fake.__writes.push(data);
    },
    resize(cols, rows) {
      fake.__resizes.push({ cols, rows });
    },
    kill() {
      fake.__killed = true;
      for (const l of exitListeners) l({ exitCode: 0 });
    },
    __emit(data) {
      for (const l of dataListeners) l(data);
    },
    __exit(exitCode, signal) {
      for (const l of exitListeners) l({ exitCode, signal });
    },
  };
  return fake;
}

function makeSpawn(): { fn: PtySpawnFn; calls: Array<{ shell: string; args: string[]; cwd: string }>; lastPty: () => FakePty } {
  const calls: Array<{ shell: string; args: string[]; cwd: string }> = [];
  let last: FakePty | undefined;
  const fn: PtySpawnFn = (shell, args, opts) => {
    calls.push({ shell, args: [...args], cwd: opts.cwd });
    last = createFakePty();
    return last;
  };
  return {
    fn,
    calls,
    lastPty: () => {
      if (!last) throw new Error("no pty spawned yet");
      return last;
    },
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PtyManager — whitelist", () => {
  let spawn: ReturnType<typeof makeSpawn>;

  beforeEach(() => {
    spawn = makeSpawn();
  });

  it("rejects 'claude' as spawn target", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    expect(() => mgr.spawn("t1", { cwd: "/tmp", shell: "claude" })).toThrow(
      PtySpawnRejectedError,
    );
  });

  it("rejects an absolute claude path via basename normalization", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    expect(() =>
      mgr.spawn("t1", { cwd: "/tmp", shell: "/usr/local/bin/claude" }),
    ).toThrow(PtySpawnRejectedError);
  });

  it("rejects an arbitrary binary like 'rm'", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    expect(() => mgr.spawn("t1", { cwd: "/tmp", shell: "rm" })).toThrow(
      PtySpawnRejectedError,
    );
  });

  it("accepts whitelisted basenames pwsh, powershell, cmd, bash, zsh, sh, fish (case-insensitive)", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    const accepted = [
      "pwsh",
      "powershell",
      "powershell.exe",
      "PWSH.exe",
      "cmd",
      "cmd.exe",
      "bash",
      "/bin/zsh",
      "/usr/bin/fish",
      "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    ];
    for (let i = 0; i < accepted.length; i++) {
      const taskId = `task-${i}`;
      expect(() => mgr.spawn(taskId, { cwd: "/tmp", shell: accepted[i] })).not.toThrow();
      mgr.kill(taskId);
    }
  });
});

describe("PtyManager — spawn / write / resize / kill", () => {
  let spawn: ReturnType<typeof makeSpawn>;

  beforeEach(() => {
    spawn = makeSpawn();
  });

  it("spawn returns a handle and records cwd + shell", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    const h = mgr.spawn("t1", { cwd: "/tmp/work", shell: "bash" });
    expect(h.taskId).toBe("t1");
    expect(h.shellKind).toBe("posix");
    expect(spawn.calls).toHaveLength(1);
    expect(spawn.calls[0].cwd).toBe("/tmp/work");
  });

  it("spawn is idempotent for the same taskId — second call returns the existing handle", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    const a = mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    const b = mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    expect(a).toBe(b);
    expect(spawn.calls).toHaveLength(1);
  });

  it("write forwards into the pty", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    mgr.write("t1", "ls\n");
    expect(spawn.lastPty().__writes).toEqual(["ls\n"]);
  });

  it("write to unknown taskId is a no-op (does not throw)", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    expect(() => mgr.write("nope", "x")).not.toThrow();
  });

  it("resize forwards cols/rows", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    mgr.resize("t1", 120, 40);
    expect(spawn.lastPty().__resizes).toEqual([{ cols: 120, rows: 40 }]);
  });

  it("kill removes the handle and calls pty.kill", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    const fake = spawn.lastPty();
    mgr.kill("t1");
    expect(fake.__killed).toBe(true);
    // Subsequent spawn for same taskId starts a fresh pty.
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    expect(spawn.calls).toHaveLength(2);
  });

  it("killAll iterates all live ptys", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    mgr.spawn("t1", { cwd: "/a", shell: "bash" });
    const f1 = spawn.lastPty();
    mgr.spawn("t2", { cwd: "/b", shell: "bash" });
    const f2 = spawn.lastPty();
    mgr.killAll();
    expect(f1.__killed).toBe(true);
    expect(f2.__killed).toBe(true);
  });
});

describe("PtyManager — subscribe + attach (writer/reader roles)", () => {
  let spawn: ReturnType<typeof makeSpawn>;

  beforeEach(() => {
    spawn = makeSpawn();
  });

  it("subscribers receive incoming pty data and unsubscribe stops further deliveries", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    const seen: string[] = [];
    const off = mgr.subscribe("t1", (d) => seen.push(d));
    spawn.lastPty().__emit("hello");
    spawn.lastPty().__emit(" world");
    off();
    spawn.lastPty().__emit(" silenced");
    expect(seen).toEqual(["hello", " world"]);
  });

  it("first attach is writer, second attach is reader; detaching the writer auto-promotes a reader (StrictMode race fence)", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    const wsA = { id: "A" };
    const wsB = { id: "B" };
    const a = mgr.attach("t1", wsA);
    const b = mgr.attach("t1", wsB);
    expect(a.role).toBe("writer");
    expect(b.role).toBe("reader");
    let promotedFires = 0;
    mgr.subscribeForConnection("t1", wsB, {
      onData: () => undefined,
      onPromoteToWriter: () => {
        promotedFires += 1;
      },
    });
    mgr.detach("t1", wsA);
    // wsB should now be writer; promotion hook fired exactly once.
    expect(promotedFires).toBe(1);
    expect(mgr.getRole("t1", wsB)).toBe("writer");
    // A new conn while wsB holds the writer slot is reader.
    const c = mgr.attach("t1", { id: "C" });
    expect(c.role).toBe("reader");
  });

  it("detaching the LAST connection kills the pty (no promotion)", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    const fake = spawn.lastPty();
    const wsA = { id: "A" };
    mgr.attach("t1", wsA);
    mgr.detach("t1", wsA);
    expect(fake.__killed).toBe(true);
  });

  it("attach() is idempotent for the same conn — re-attach keeps writer role (external review F6 regression fence)", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    const wsA = { id: "A" };
    expect(mgr.attach("t1", wsA).role).toBe("writer");
    // Re-attach by the same conn must NOT flip writer to reader.
    expect(mgr.attach("t1", wsA).role).toBe("writer");
    expect(mgr.attach("t1", wsA).role).toBe("writer");
    // A different conn still gets reader.
    expect(mgr.attach("t1", { id: "B" }).role).toBe("reader");
  });

  it("getRole() is non-mutating and returns the right role for known/unknown conns", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    const wsA = { id: "A" };
    const wsB = { id: "B" };
    mgr.attach("t1", wsA);
    mgr.attach("t1", wsB);
    expect(mgr.getRole("t1", wsA)).toBe("writer");
    expect(mgr.getRole("t1", wsB)).toBe("reader");
    expect(mgr.getRole("t1", { id: "C" })).toBe(null);
    expect(mgr.getRole("unknown-task", wsA)).toBe(null);
    // Calling getRole many times does NOT change the writer slot.
    for (let i = 0; i < 10; i++) mgr.getRole("t1", wsA);
    expect(mgr.getRole("t1", wsA)).toBe("writer");
  });

  it("hasActiveWriter reflects writer-slot occupancy (used by /paste-image gate)", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    expect(mgr.hasActiveWriter("t1")).toBe(false);
    const wsA = { id: "A" };
    mgr.attach("t1", wsA);
    expect(mgr.hasActiveWriter("t1")).toBe(true);
    mgr.detach("t1", wsA);
    expect(mgr.hasActiveWriter("t1")).toBe(false);
    expect(mgr.hasActiveWriter("unknown-task")).toBe(false);
  });

  it("when last connection detaches, the pty is killed automatically", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    const fake = spawn.lastPty();
    const wsA = { id: "A" };
    mgr.attach("t1", wsA);
    expect(fake.__killed).toBe(false);
    mgr.detach("t1", wsA);
    expect(fake.__killed).toBe(true);
  });
});

describe("PtyManager — backpressure (per-conn outbound buffer drop-oldest)", () => {
  let spawn: ReturnType<typeof makeSpawn>;

  beforeEach(() => {
    spawn = makeSpawn();
  });

  it("oldest chunks are dropped when bufferedAmount exceeds the cap; backpressure callback is fired once per saturation", () => {
    const mgr = new PtyManager({ spawn: spawn.fn, wsBufferBytes: 10 });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    const ws = { id: "A", bufferedAmount: 0 };
    const delivered: string[] = [];
    let backpressureFires = 0;
    mgr.attach("t1", ws);
    mgr.subscribeForConnection("t1", ws, {
      onData: (d) => delivered.push(d),
      onBackpressure: () => {
        backpressureFires++;
      },
    });
    // Simulate ws not draining — we keep bufferedAmount high.
    ws.bufferedAmount = 100;
    spawn.lastPty().__emit("AAAA");
    spawn.lastPty().__emit("BBBB");
    spawn.lastPty().__emit("CCCC");
    // Now drain.
    ws.bufferedAmount = 0;
    spawn.lastPty().__emit("DD");
    expect(delivered.join("")).not.toContain("AAAA"); // dropped
    expect(delivered.some((d) => d.includes("DD"))).toBe(true);
    expect(backpressureFires).toBeGreaterThanOrEqual(1);
  });
});

describe("PtyManager — idle timeout safety ceiling", () => {
  let spawn: ReturnType<typeof makeSpawn>;

  beforeEach(() => {
    spawn = makeSpawn();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("no read+write activity for terminalIdleTimeoutMs forces a kill", () => {
    const mgr = new PtyManager({ spawn: spawn.fn, idleTimeoutMs: 1000 });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    const fake = spawn.lastPty();
    expect(fake.__killed).toBe(false);
    vi.advanceTimersByTime(900);
    expect(fake.__killed).toBe(false);
    vi.advanceTimersByTime(200);
    expect(fake.__killed).toBe(true);
  });

  it("activity (write) resets the idle timer", () => {
    const mgr = new PtyManager({ spawn: spawn.fn, idleTimeoutMs: 1000 });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    const fake = spawn.lastPty();
    vi.advanceTimersByTime(800);
    mgr.write("t1", "x");
    vi.advanceTimersByTime(800);
    expect(fake.__killed).toBe(false);
    vi.advanceTimersByTime(300);
    expect(fake.__killed).toBe(true);
  });

  it("activity (incoming pty data) resets the idle timer", () => {
    const mgr = new PtyManager({ spawn: spawn.fn, idleTimeoutMs: 1000 });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    const fake = spawn.lastPty();
    vi.advanceTimersByTime(800);
    fake.__emit("from shell");
    vi.advanceTimersByTime(800);
    expect(fake.__killed).toBe(false);
  });
});

describe("quotePathForShell", () => {
  it("pwsh — single-quotes with internal '' doubling", () => {
    expect(quotePathForShell("C:\\My Project\\img.png", "pwsh")).toBe(
      "'C:\\My Project\\img.png'",
    );
    expect(quotePathForShell("a'b", "pwsh")).toBe("'a''b'");
  });

  it("cmd — double-quotes; embedded \" is escaped to \"\"", () => {
    expect(quotePathForShell("C:\\My Project\\img.png", "cmd")).toBe(
      '"C:\\My Project\\img.png"',
    );
    expect(quotePathForShell('a"b', "cmd")).toBe('"a""b"');
  });

  it("posix — single-quotes with internal ' escaped via '\\''", () => {
    expect(quotePathForShell("/tmp/My Project/img.png", "posix")).toBe(
      "'/tmp/My Project/img.png'",
    );
    expect(quotePathForShell("a'b", "posix")).toBe("'a'\\''b'");
  });
});

describe("PtyManager — shellKind inference", () => {
  let spawn: ReturnType<typeof makeSpawn>;

  beforeEach(() => {
    spawn = makeSpawn();
  });

  it("pwsh / powershell.exe → 'pwsh'", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    const a = mgr.spawn("t1", { cwd: "/tmp", shell: "pwsh" });
    expect(a.shellKind).toBe("pwsh");
    mgr.kill("t1");
    const b = mgr.spawn("t1", { cwd: "/tmp", shell: "powershell.exe" });
    expect(b.shellKind).toBe("pwsh");
  });

  it("cmd / cmd.exe → 'cmd'", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    const a = mgr.spawn("t1", { cwd: "/tmp", shell: "cmd.exe" });
    expect(a.shellKind).toBe("cmd");
  });

  it("bash / zsh / sh / fish → 'posix'", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    for (const s of ["bash", "/bin/zsh", "sh", "/usr/bin/fish"]) {
      mgr.kill("t1");
      const a = mgr.spawn("t1", { cwd: "/tmp", shell: s });
      expect(a.shellKind).toBe("posix");
    }
  });
});
