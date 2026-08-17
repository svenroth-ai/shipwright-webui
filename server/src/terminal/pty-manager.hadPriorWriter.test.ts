/*
 * pty-manager.hadPriorWriter.test.ts
 * iterate-2026-05-27-fix-pty-reused-prewarm-race, refined
 * iterate-2026-08-16-task-lifecycle-ux-fixes.
 *
 * New file rather than an addition to pty-manager.test.ts: that one is
 * bloat-baselined at 600 lines, so growing it further would trip the
 * anti-ratchet hook (same reasoning as pty-manager.shell-stopped-marker.test.ts
 * / pty-manager.idle-attachment.test.ts / pty-manager.backpressure-notice.test.ts).
 * The FakePty/makeSpawn doubles below are a verbatim duplicate of the main
 * suite's, per that established convention.
 *
 * hadPriorWriter is sourced from `hadDataWritten` (real input), NOT
 * attach-count — a pty that only ever had passive viewer attaches (no
 * keystroke, no injected launch) must report `false` no matter how many
 * times it was attached to. Atomic snapshot inside attach() (race-fence +
 * transitions).
 */

import { beforeEach, describe, expect, it } from "vitest";
import { PtyManager, type PtySpawnFn, type PtyHandleApi } from "./pty-manager.js";

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

describe("PtyManager — hadPriorWriter (real-input tracking)", () => {
  let spawn: ReturnType<typeof makeSpawn>;

  beforeEach(() => {
    spawn = makeSpawn();
  });

  // @covers FR-01.28
  it("first attach immediately after spawn returns hadPriorWriter: false (prewarm-race fix)", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    const wsA = { id: "A" };
    const a = mgr.attach("t1", wsA);
    expect(a.role).toBe("writer");
    expect(a.hadPriorWriter).toBe(false);
  });

  // @covers FR-01.28
  it("a second attach (different conn) with NO data ever written still returns hadPriorWriter: false (the Backlog-revisit regression fence)", () => {
    // This is the exact shape of the bug: a never-launched task's detail
    // page is viewed, left, and viewed again (or the WS merely
    // reconnects) — two writer-slot attaches, zero keystrokes, zero
    // injected commands. The pty is still virgin; auto-inject must stay
    // armed for the eventual real Launch.
    const mgr = new PtyManager({ spawn: spawn.fn });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    const wsA = { id: "A" };
    const wsB = { id: "B" };
    const a = mgr.attach("t1", wsA);
    mgr.detach("t1", wsA);
    const b = mgr.attach("t1", wsB);
    expect(a.hadPriorWriter).toBe(false);
    expect(b.role).toBe("writer");
    expect(b.hadPriorWriter).toBe(false);
  });

  // @covers FR-01.28
  it("re-attach by the same conn with no data written stays hadPriorWriter: false", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    const wsA = { id: "A" };
    const first = mgr.attach("t1", wsA);
    const second = mgr.attach("t1", wsA);
    expect(first.hadPriorWriter).toBe(false);
    expect(second.role).toBe("writer");
    expect(second.hadPriorWriter).toBe(false);
  });

  // @covers FR-01.28
  it("once data has been written, the NEXT new-conn attach (even after the writer detaches) returns hadPriorWriter: true (the reload regression fence)", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    const wsA = { id: "A" };
    const wsB = { id: "B" };
    const a = mgr.attach("t1", wsA);
    expect(a.hadPriorWriter).toBe(false);
    // A real keystroke / auto-injected launch command lands here.
    mgr.write("t1", "claude --resume\r");
    mgr.detach("t1", wsA);
    // Even though no writer is currently bound (entry.writer === null),
    // the flag persists — real input already reached this pty.
    const b = mgr.attach("t1", wsB);
    expect(b.role).toBe("writer");
    expect(b.hadPriorWriter).toBe(true);
  });

  // @covers FR-01.28
  it("reader-promotion to writer does NOT decrease the flag once data was written (defensive)", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    const wsA = { id: "A" };
    const wsB = { id: "B" };
    mgr.attach("t1", wsA);
    mgr.write("t1", "hello\r");
    const b = mgr.attach("t1", wsB);
    expect(b.hadPriorWriter).toBe(true); // data already written via wsA
    mgr.subscribeForConnection("t1", wsB, { onData: () => undefined });
    mgr.detach("t1", wsA);
    // wsB is now writer (auto-promoted). A third conn attaching now MUST
    // still see hadPriorWriter: true.
    const c = mgr.attach("t1", { id: "C" });
    expect(c.hadPriorWriter).toBe(true);
  });

  // @covers FR-01.28
  it("two back-to-back attaches with no data written both see hadPriorWriter: false (race fence — atomic API)", () => {
    // External review HIGH: a separate read-then-mutate API would let
    // two near-simultaneous attaches race on a stale read. The
    // atomic-inside-attach() contract is what holds the invariant —
    // still true under the hadDataWritten source, just with the
    // (false, false) pair a virgin pty actually owes both callers.
    const mgr = new PtyManager({ spawn: spawn.fn });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    const a = mgr.attach("t1", { id: "A" });
    const b = mgr.attach("t1", { id: "B" });
    expect(a.hadPriorWriter).toBe(false);
    expect(b.hadPriorWriter).toBe(false);
  });

  // @covers FR-01.28
  it("a second attach AFTER data was written to a still-active writer returns hadPriorWriter: true", () => {
    const mgr = new PtyManager({ spawn: spawn.fn });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    const a = mgr.attach("t1", { id: "A" });
    mgr.write("t1", "echo hi\r");
    const b = mgr.attach("t1", { id: "B" });
    expect(a.hadPriorWriter).toBe(false);
    expect(b.role).toBe("reader");
    expect(b.hadPriorWriter).toBe(true);
  });

  // @covers FR-01.28
  it("known residual gap (doubt-review, trg-cdf2bade): an ORDINARY keystroke — not a launch command — still latches hadPriorWriter true for the next attach", () => {
    // write() has no way to distinguish an auto-injected launch command
    // from a stray keystroke/paste typed into a never-launched task's
    // terminal — both reach this exact call. This test pins that as
    // CURRENT, ACCEPTED behavior (narrower than the pre-fix bug, which
    // fired on a bare passive attach with zero interaction) rather than
    // silently letting a future change assume the gap is closed.
    const mgr = new PtyManager({ spawn: spawn.fn });
    mgr.spawn("t1", { cwd: "/tmp", shell: "bash" });
    mgr.attach("t1", { id: "A" });
    mgr.write("t1", "ls\r"); // ordinary command, not a launch injection
    const b = mgr.attach("t1", { id: "B" }); // simulates a revisit/reconnect
    expect(b.hadPriorWriter).toBe(true);
  });
});
