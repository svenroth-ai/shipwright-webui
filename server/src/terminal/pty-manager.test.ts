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
  chunkUtf8ForPtyWrite,
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

  // @covers FR-01.28
  it("rejects 'claude' as spawn target", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    expect(() => mgr.spawn("t1", { cwd: "/tmp", shell: "claude" })).toThrow(
      PtySpawnRejectedError,
    );
  });

  // @covers FR-01.28
  it("rejects an absolute claude path via basename normalization", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    expect(() =>
      mgr.spawn("t1", { cwd: "/tmp", shell: "/usr/local/bin/claude" }),
    ).toThrow(PtySpawnRejectedError);
  });

  // @covers FR-01.28
  it("rejects an arbitrary binary like 'rm'", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    expect(() => mgr.spawn("t1", { cwd: "/tmp", shell: "rm" })).toThrow(
      PtySpawnRejectedError,
    );
  });

  // @covers FR-01.28
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

  // @covers FR-01.28
  it("spawn returns a handle and records cwd + shell", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    const h = mgr.spawn("t1", { cwd: "/tmp/work", shell: "bash" });
    expect(h.taskId).toBe("t1");
    expect(h.shellKind).toBe("posix");
    expect(spawn.calls).toHaveLength(1);
    expect(spawn.calls[0].cwd).toBe("/tmp/work");
  });

  // @covers FR-01.28
  it("spawn is idempotent for the same taskId — second call returns the existing handle", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    const a = mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    const b = mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    expect(a).toBe(b);
    expect(spawn.calls).toHaveLength(1);
  });

  // @covers FR-01.28
  it("write forwards into the pty", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    mgr.write("t1", "ls\n");
    expect(spawn.lastPty().__writes).toEqual(["ls\n"]);
  });

  // @covers FR-01.28
  it("write to unknown taskId is a no-op (does not throw)", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    expect(() => mgr.write("nope", "x")).not.toThrow();
  });

  // @covers FR-01.28
  it("resize forwards cols/rows", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    mgr.resize("t1", 120, 40);
    expect(spawn.lastPty().__resizes).toEqual([{ cols: 120, rows: 40 }]);
  });

  // @covers FR-01.28
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

  // @covers FR-01.28
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

describe("chunkUtf8ForPtyWrite", () => {
  it("returns the whole string as one chunk when under the byte cap", () => {
    expect(chunkUtf8ForPtyWrite("ls\n", 512)).toEqual(["ls\n"]);
  });

  it("splits an oversized ASCII string into chunks no larger than the cap", () => {
    const data = "a".repeat(1300);
    const chunks = chunkUtf8ForPtyWrite(data, 512);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(Buffer.byteLength(c, "utf8")).toBeLessThanOrEqual(512);
    expect(chunks.join("")).toBe(data);
  });

  it("never splits a multi-byte UTF-8 sequence across a chunk boundary", () => {
    // "€" is 3 bytes (E2 82 AC) in UTF-8 — pad so a naive byte-index split
    // would land mid-sequence at the chunk boundary.
    const data = "a".repeat(9) + "€" + "b".repeat(9);
    const chunks = chunkUtf8ForPtyWrite(data, 10);
    // Round-tripping through Buffer.from(chunk, "utf8") must reproduce the
    // original text exactly — a split mid-sequence would corrupt it into
    // replacement characters instead.
    expect(chunks.join("")).toBe(data);
    for (const c of chunks) {
      expect(Buffer.byteLength(c, "utf8")).toBeLessThanOrEqual(10);
    }
  });

  // Code-review finding 1 (2026-09-05): an unclamped maxBytes <= 0 never let
  // `start` advance, spinning the while-loop forever — exactly the "whole
  // main thread blocked" failure this helper exists to eliminate. These
  // cases terminate (the surrounding `it` would time out otherwise) and
  // still round-trip exactly.
  it.each([0, -5, 1, 2, 3])("terminates and round-trips exactly when maxBytes=%d (clamped to a 4-byte floor)", (maxBytes) => {
    const data = "a".repeat(9) + "€" + "b".repeat(9);
    const chunks = chunkUtf8ForPtyWrite(data, maxBytes);
    expect(chunks.join("")).toBe(data);
    for (const c of chunks) {
      expect(Buffer.byteLength(c, "utf8")).toBeLessThanOrEqual(4);
      expect(Buffer.byteLength(c, "utf8")).toBeGreaterThan(0);
    }
  });
});

describe("PtyManager — chunked pty write (iterate-2026-09-05-terminal-large-command-chunked-pty-write)", () => {
  let spawn: ReturnType<typeof makeSpawn>;

  beforeEach(() => {
    spawn = makeSpawn();
  });

  // @covers FR-01.28
  it("a write at/under the chunk cap is forwarded as a single, unmodified pty.write call", () => {
    const mgr = new PtyManager({ spawn: spawn.fn, ptyWriteChunkBytes: 512 });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    mgr.write("t1", "ls\n");
    expect(spawn.lastPty().__writes).toEqual(["ls\n"]);
  });

  // @covers FR-01.28
  it("an oversized single-burst write (repro: 6 KB launch command) is split into sub-cap chunks, none of which individually exceeds the cap", () => {
    const scheduled: Array<() => void> = [];
    const mgr = new PtyManager({
      spawn: spawn.fn,
      ptyWriteChunkBytes: 512,
      scheduleChunkWrite: (cb) => scheduled.push(cb),
    });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    const command = `claude --session-id abc "${"x".repeat(6000)}"\r`;
    mgr.write("t1", command);

    // First chunk is written synchronously; the rest wait on the injected
    // scheduler — proving the whole burst is NOT written in one atomic call.
    expect(spawn.lastPty().__writes.length).toBe(1);
    expect(scheduled.length).toBe(1);

    while (scheduled.length > 0) {
      const next = scheduled.shift()!;
      next();
    }

    const writes = spawn.lastPty().__writes;
    expect(writes.length).toBeGreaterThan(10); // 6KB / 512B ≈ 12 chunks
    for (const w of writes) {
      expect(Buffer.byteLength(w, "utf8")).toBeLessThanOrEqual(512);
    }
    expect(writes.join("")).toBe(command);
  });

  // @covers FR-01.28
  it("the default scheduler yields real event-loop turns between chunks (does not write the whole burst in one microtask)", () => {
    vi.useFakeTimers();
    try {
      const mgr = new PtyManager({ spawn: spawn.fn, ptyWriteChunkBytes: 512 });
      mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
      mgr.write("t1", "y".repeat(2000));

      // Only the first chunk should have landed before any timer fires.
      expect(spawn.lastPty().__writes.length).toBe(1);

      vi.advanceTimersByTime(5);
      expect(spawn.lastPty().__writes.length).toBe(2);

      vi.runAllTimers();
      const writes = spawn.lastPty().__writes;
      expect(writes.length).toBe(4); // ceil(2000/512)
      expect(writes.join("")).toBe("y".repeat(2000));
    } finally {
      vi.useRealTimers();
    }
  });

  // @covers FR-01.28
  it("a task killed mid-chunked-write stops delivering the remaining chunks", () => {
    const scheduled: Array<() => void> = [];
    const mgr = new PtyManager({
      spawn: spawn.fn,
      ptyWriteChunkBytes: 512,
      scheduleChunkWrite: (cb) => scheduled.push(cb),
    });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    mgr.write("t1", "z".repeat(2000));
    const fake = spawn.lastPty();
    expect(fake.__writes.length).toBe(1);

    void mgr.kill("t1");
    expect(fake.__killed).toBe(true);

    // Draining the still-pending scheduled callbacks must not resurrect
    // writes into the now-torn-down pty.
    while (scheduled.length > 0) {
      const next = scheduled.shift()!;
      next();
    }
    expect(fake.__writes.length).toBe(1);
  });

  // Doubt-review finding (2026-09-05, info-level): the respawn-safety claim
  // (a fresh entry object always starts with chunkWriteBusy/pendingWrites
  // unset) held by construction but had no dedicated test. Converts that
  // structural argument into a guarded invariant.
  it("a respawn for the same taskId after a kill-mid-drain starts with a clean write queue (not blocked by the old entry's stale busy state)", () => {
    const scheduled: Array<() => void> = [];
    const mgr = new PtyManager({
      spawn: spawn.fn,
      ptyWriteChunkBytes: 512,
      scheduleChunkWrite: (cb) => scheduled.push(cb),
    });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    mgr.write("t1", "z".repeat(2000)); // starts draining, chunkWriteBusy = true on the OLD entry
    void mgr.kill("t1");

    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" }); // respawn — a fresh entry/pty
    const respawned = spawn.lastPty();
    mgr.write("t1", "ready\n");

    // The new entry's write must land immediately — not queued behind the
    // old, torn-down entry's now-irrelevant busy state.
    expect(respawned.__writes).toEqual(["ready\n"]);
  });

  // Code-review finding 2 (2026-09-05): a second write() for the same task
  // arriving mid-drain (e.g. a keystroke, or the paste-image insertion)
  // must NOT interleave into the still-draining first burst — it queues
  // and is delivered only once the in-flight burst fully drains.
  it("a write arriving mid-drain is queued, not interleaved, behind the in-flight chunked write", () => {
    const scheduled: Array<() => void> = [];
    const mgr = new PtyManager({
      spawn: spawn.fn,
      ptyWriteChunkBytes: 512,
      scheduleChunkWrite: (cb) => scheduled.push(cb),
    });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    const firstBurst = "x".repeat(2000); // 4 chunks at 512B
    mgr.write("t1", firstBurst);
    expect(spawn.lastPty().__writes.length).toBe(1);
    expect(scheduled.length).toBe(1);

    // A keystroke lands while the first burst is still mid-drain.
    mgr.write("t1", "y");
    // Must NOT land immediately — that would interleave it into the burst.
    expect(spawn.lastPty().__writes.length).toBe(1);
    expect(scheduled.length).toBe(1);

    while (scheduled.length > 0) {
      const next = scheduled.shift()!;
      next();
    }

    const writes = spawn.lastPty().__writes;
    // The queued keystroke is delivered LAST, as its own write call — never
    // spliced into the middle of the burst's chunks.
    expect(writes[writes.length - 1]).toBe("y");
    expect(writes.slice(0, -1).join("")).toBe(firstBurst);
  });

  // Same guard, but the queued write is itself oversized — proves the
  // queue re-chunks a queued burst rather than only handling small ones.
  it("a second oversized write queued mid-drain is itself chunked once its turn comes", () => {
    const scheduled: Array<() => void> = [];
    const mgr = new PtyManager({
      spawn: spawn.fn,
      ptyWriteChunkBytes: 512,
      scheduleChunkWrite: (cb) => scheduled.push(cb),
    });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    const firstBurst = "x".repeat(1000);
    const secondBurst = "y".repeat(1000);
    mgr.write("t1", firstBurst);
    mgr.write("t1", secondBurst);

    while (scheduled.length > 0) {
      const next = scheduled.shift()!;
      next();
    }

    const writes = spawn.lastPty().__writes;
    expect(writes.join("")).toBe(firstBurst + secondBurst);
    for (const w of writes) expect(Buffer.byteLength(w, "utf8")).toBeLessThanOrEqual(512);
  });

  // Doubt-review finding (2026-09-05): writeMouseReport() used to write
  // straight to entry.pty, bypassing the same-task queue entirely — a
  // reader's scroll gesture could splice into a still-draining burst.
  it("a mouse report arriving mid-drain is queued behind the in-flight burst, not spliced into it", () => {
    const scheduled: Array<() => void> = [];
    const mgr = new PtyManager({
      spawn: spawn.fn,
      ptyWriteChunkBytes: 512,
      scheduleChunkWrite: (cb) => scheduled.push(cb),
    });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    const firstBurst = "x".repeat(2000);
    mgr.write("t1", firstBurst);
    expect(scheduled.length).toBe(1);

    const mouseReport = "\x1b[<64;30;7M";
    mgr.writeMouseReport("t1", mouseReport);
    // Must NOT land immediately — that would splice it into the burst.
    expect(spawn.lastPty().__writes.length).toBe(1);

    while (scheduled.length > 0) {
      const next = scheduled.shift()!;
      next();
    }

    const writes = spawn.lastPty().__writes;
    expect(writes[writes.length - 1]).toBe(mouseReport);
    expect(writes.slice(0, -1).join("")).toBe(firstBurst);
  });

  // Doubt-review finding (2026-09-05): pendingWrites must not grow without
  // bound under a flooding/buggy client — the new write is dropped whole
  // (never truncated/corrupted) once the cap is exceeded.
  it("a write that would exceed the pendingWrites byte cap is dropped whole, without corrupting the already-queued writes", () => {
    const scheduled: Array<() => void> = [];
    const mgr = new PtyManager({
      spawn: spawn.fn,
      ptyWriteChunkBytes: 512,
      pendingWriteBytesCap: 100,
      scheduleChunkWrite: (cb) => scheduled.push(cb),
    });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    mgr.write("t1", "x".repeat(1000)); // starts draining, chunkWriteBusy = true
    mgr.write("t1", "y".repeat(50)); // queued: 50 bytes, under the 100-byte cap
    mgr.write("t1", "z".repeat(80)); // would push the queue to 130 bytes — dropped

    while (scheduled.length > 0) {
      const next = scheduled.shift()!;
      next();
    }

    const writes = spawn.lastPty().__writes;
    const joined = writes.join("");
    expect(joined).toContain("y".repeat(50));
    expect(joined).not.toContain("z");
  });

  // External-review finding (2026-09-05, Tier-3, BLOCKING): draining a large
  // queue of small writes used to recurse one stack frame per queued write
  // (deliverOrChunk -> drainPendingWrites -> deliverOrChunk -> ...), so a
  // client flooding tiny writes during a burst's ~60ms drain window could
  // blow the call stack and crash the whole process — the exact "frozen/
  // dead server" failure this fix exists to eliminate. Draining is now an
  // iterative loop; this proves a very large queue drains without throwing
  // and preserves delivery order.
  it("draining a very large queue of small writes does not overflow the stack, and preserves delivery order", () => {
    const scheduled: Array<() => void> = [];
    const mgr = new PtyManager({
      spawn: spawn.fn,
      ptyWriteChunkBytes: 512,
      pendingWriteBytesCap: 10_000_000,
      scheduleChunkWrite: (cb) => scheduled.push(cb),
    });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    mgr.write("t1", "x".repeat(1000)); // starts draining, chunkWriteBusy = true

    const QUEUED = 20_000;
    for (let i = 0; i < QUEUED; i++) {
      mgr.write("t1", `${i}\n`);
    }

    expect(() => {
      while (scheduled.length > 0) {
        const next = scheduled.shift()!;
        next();
      }
    }).not.toThrow();

    const writes = spawn.lastPty().__writes;
    // The 1000-byte burst chunks, followed by every queued write, in order.
    const tail = writes.slice(-QUEUED);
    expect(tail.join("")).toBe(
      Array.from({ length: QUEUED }, (_, i) => `${i}\n`).join(""),
    );
  });
});

describe("PtyManager — subscribe + attach (writer/reader roles)", () => {
  let spawn: ReturnType<typeof makeSpawn>;

  beforeEach(() => {
    spawn = makeSpawn();
  });

  // @covers FR-01.28
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

  // @covers FR-01.28
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

  // @covers FR-01.28
  it("detaching the LAST connection KEEPS the pty alive (ADR-068-A1 Replay-on-Attach)", () => {
    // 2026-05-05 — last-detach no longer kills the pty. The previous
    // policy collided with the Replay-on-Attach contract: any
    // TaskBoard ↔ TaskDetail navigation closed the WS, killed the pty,
    // and produced a brand-new shell with no claude session. Orphan GC
    // now relies on the 30-min idle ceiling + explicit user actions
    // (Stop terminal session / DELETE task / server shutdown).
    const mgr = new PtyManager({ spawn: spawn.fn });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    const fake = spawn.lastPty();
    const wsA = { id: "A" };
    mgr.attach("t1", wsA);
    mgr.detach("t1", wsA);
    expect(fake.__killed).toBe(false);
    // pty entry still exists — re-attach must succeed without re-spawn.
    expect(mgr.get("t1")).toBeDefined();
  });

  // @covers FR-01.28
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

  // hadPriorWriter tests moved to pty-manager.hadPriorWriter.test.ts
  // (iterate-2026-08-16-task-lifecycle-ux-fixes, bloat split).

  // @covers FR-01.28
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

  // @covers FR-01.28
  it("writer-promoted callback fires SYNCHRONOUSLY inside detach() — required by client banner-grace (ADR-084 AC-1)", () => {
    // The client's 1500ms read-only banner grace (EmbeddedTerminal.tsx)
    // assumes that when StrictMode mount-1 detaches, the server promotes
    // mount-2 → writer SYNCHRONOUSLY, so `writer-promoted` reaches the
    // client within a network RTT — well inside the grace window. If the
    // server-side promotion ever moves into a microtask / setImmediate /
    // setTimeout(0), the banner becomes a UX flicker (banner armed →
    // briefly visible → hidden by writer-promoted). Lock the contract.
    const mgr = new PtyManager({ spawn: spawn.fn });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    const wsA = { id: "A" };
    const wsB = { id: "B" };
    mgr.attach("t1", wsA);
    mgr.attach("t1", wsB);
    let promoted = false;
    mgr.subscribeForConnection("t1", wsB, {
      onData: () => undefined,
      onPromoteToWriter: () => {
        promoted = true;
      },
    });
    // Call detach + assert SAME tick — no `await` between detach + check.
    mgr.detach("t1", wsA);
    expect(promoted).toBe(true); // promotion is synchronous.
    expect(mgr.getRole("t1", wsB)).toBe("writer");
  });

  // @covers FR-01.28
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

  // @covers FR-01.28
  it("explicit kill() terminates the pty (Stop / Close / DELETE entry points)", () => {
    // 2026-05-05 — pty teardown is now driven by explicit user actions or
    // the 30-min idle ceiling, not by last-detach. This test pins down
    // the explicit-kill path that "Stop terminal session", DELETE task
    // cascade, and server shutdown all flow through.
    const mgr = new PtyManager({ spawn: spawn.fn });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    const fake = spawn.lastPty();
    const wsA = { id: "A" };
    mgr.attach("t1", wsA);
    expect(fake.__killed).toBe(false);
    mgr.detach("t1", wsA);
    expect(fake.__killed).toBe(false);
    mgr.kill("t1");
    expect(fake.__killed).toBe(true);
    expect(mgr.get("t1")).toBeUndefined();
  });
});

describe("PtyManager — backpressure (per-conn outbound buffer drop-oldest)", () => {
  let spawn: ReturnType<typeof makeSpawn>;

  beforeEach(() => {
    spawn = makeSpawn();
  });

  // @covers FR-01.28
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

  // @covers FR-01.28
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

  // @covers FR-01.28
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

  // @covers FR-01.28
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
  // @covers FR-01.28
  it("pwsh — single-quotes with internal '' doubling", () => {
    expect(quotePathForShell("C:\\My Project\\img.png", "pwsh")).toBe(
      "'C:\\My Project\\img.png'",
    );
    expect(quotePathForShell("a'b", "pwsh")).toBe("'a''b'");
  });

  // @covers FR-01.28
  it("cmd — double-quotes; embedded \" is escaped to \"\"", () => {
    expect(quotePathForShell("C:\\My Project\\img.png", "cmd")).toBe(
      '"C:\\My Project\\img.png"',
    );
    expect(quotePathForShell('a"b', "cmd")).toBe('"a""b"');
  });

  // @covers FR-01.28
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

  // @covers FR-01.28
  it("pwsh / powershell.exe → 'pwsh'", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    const a = mgr.spawn("t1", { cwd: "/tmp", shell: "pwsh" });
    expect(a.shellKind).toBe("pwsh");
    mgr.kill("t1");
    const b = mgr.spawn("t1", { cwd: "/tmp", shell: "powershell.exe" });
    expect(b.shellKind).toBe("pwsh");
  });

  // @covers FR-01.28
  it("cmd / cmd.exe → 'cmd'", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    const a = mgr.spawn("t1", { cwd: "/tmp", shell: "cmd.exe" });
    expect(a.shellKind).toBe("cmd");
  });

  // @covers FR-01.28
  it("bash / zsh / sh / fish → 'posix'", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    for (const s of ["bash", "/bin/zsh", "sh", "/usr/bin/fish"]) {
      mgr.kill("t1");
      const a = mgr.spawn("t1", { cwd: "/tmp", shell: s });
      expect(a.shellKind).toBe("posix");
    }
  });
});
