/*
 * pty-manager-live-snapshot.test.ts — Iterate E (ADR-092).
 *
 * Covers the two new write surfaces that close the ADR-091 live-pty
 * regression:
 *   - `serializeMirrorIfLive(taskId)` — in-memory SnapshotRecord
 *     producer; used by the WS attach replay flow as a fallback when
 *     the disk read returns null for a live pty.
 *   - `flushMirrorSnapshot(taskId)`  — disk persistence trigger fired
 *     from the WS detach path when the last subscriber leaves.
 *     Does NOT dispose the mirror (the pty stays alive).
 *
 * Tests use FakePty + a temp-dir SnapshotStore so no native pty
 * binary or real @xterm/headless wire-up is required. The
 * HeadlessMirror is wired by PtyManager when both flag+store are
 * present — that path is exercised end-to-end here.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  PtyManager,
  type PtyHandleApi,
  type PtySpawnFn,
} from "./pty-manager.js";
import { ScrollbackStore } from "./scrollback-store.js";
import { SnapshotStore } from "./snapshot-store.js";

const TASK = "11111111-2222-3333-4444-555555555555";

interface FakePty extends PtyHandleApi {
  __killed: boolean;
  __emit(data: string): void;
  __exit(exitCode: number, signal?: number): void;
}

function createFakePty(): FakePty {
  const dataListeners: Array<(s: string) => void> = [];
  const exitListeners: Array<(e: { exitCode: number; signal?: number }) => void> = [];
  const fake: FakePty = {
    __killed: false,
    onData(cb) {
      dataListeners.push(cb);
      return { dispose() {} };
    },
    onExit(cb) {
      exitListeners.push(cb);
      return { dispose() {} };
    },
    write() {},
    resize() {},
    kill() {
      fake.__killed = true;
      for (const l of exitListeners) l({ exitCode: 0 });
    },
    pause() {},
    resume() {},
    __emit(data) {
      for (const l of dataListeners) l(data);
    },
    __exit(exitCode, signal) {
      for (const l of exitListeners) l({ exitCode, signal });
    },
  };
  return fake;
}

function makeSpawn(): { fn: PtySpawnFn; lastPty: () => FakePty } {
  let last: FakePty | undefined;
  const fn: PtySpawnFn = () => {
    last = createFakePty();
    return last;
  };
  return {
    fn,
    lastPty: () => {
      if (!last) throw new Error("no pty spawned yet");
      return last;
    },
  };
}

async function flushMicrotasks(ms = 100): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

describe("PtyManager — serializeMirrorIfLive (ADR-092 AC #2)", () => {
  let dir: string;
  let scrollback: ScrollbackStore;
  let snapshot: SnapshotStore;
  let spawn: ReturnType<typeof makeSpawn>;

  beforeEach(async () => {
    dir = fsSync.mkdtempSync(path.join(os.tmpdir(), "pty-live-snap-"));
    scrollback = new ScrollbackStore(dir, { maxBytesPerTask: 4096 });
    await scrollback.init();
    snapshot = new SnapshotStore(dir);
    await snapshot.init();
    spawn = makeSpawn();
  });

  afterEach(async () => {
    await scrollback.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  // A2.1
  it("returns a valid SnapshotRecord when a live mirror exists", async () => {
    const mgr = new PtyManager({
      spawn: spawn.fn,
      scrollbackStore: scrollback,
      headlessMirrorEnabled: true,
      snapshotStore: snapshot,
      expectedTerminalVersion: "5.5.0",
      idleTimeoutMs: 60_000,
    });
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
    spawn.lastPty().__emit("live-content\r\n");
    // Let the headless-mirror's async write() callback fire.
    await flushMicrotasks(50);

    const rec = await mgr.serializeMirrorIfLive(TASK);
    expect(rec).not.toBeNull();
    expect(rec!.version).toBe("v1");
    expect(rec!.terminalVersion).toBe("5.5.0");
    expect(rec!.cols).toBe(120);
    expect(rec!.rows).toBe(30);
    // M2 stable serialize output is non-empty when content was written.
    expect(rec!.data.length).toBeGreaterThan(0);

    mgr.kill(TASK);
    await flushMicrotasks(200);
  });

  // A2.2
  it("returns null when no entry for taskId", async () => {
    const mgr = new PtyManager({
      spawn: spawn.fn,
      headlessMirrorEnabled: true,
      snapshotStore: snapshot,
      expectedTerminalVersion: "5.5.0",
      idleTimeoutMs: 60_000,
    });
    const rec = await mgr.serializeMirrorIfLive(TASK);
    expect(rec).toBeNull();
  });

  // A2.3
  it("returns null when entry has no mirror (flag off)", async () => {
    const mgr = new PtyManager({
      spawn: spawn.fn,
      scrollbackStore: scrollback,
      // flag OFF — no mirror is created on spawn().
      idleTimeoutMs: 60_000,
    });
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
    const rec = await mgr.serializeMirrorIfLive(TASK);
    expect(rec).toBeNull();
    mgr.kill(TASK);
  });

  // A2.5 — dims propagate after resize
  it("returned record cols/rows match the mirror's current dimensions", async () => {
    const mgr = new PtyManager({
      spawn: spawn.fn,
      scrollbackStore: scrollback,
      headlessMirrorEnabled: true,
      snapshotStore: snapshot,
      expectedTerminalVersion: "5.5.0",
      idleTimeoutMs: 60_000,
    });
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
    mgr.resize(TASK, 80, 24);
    spawn.lastPty().__emit("hello\r\n");
    await flushMicrotasks(50);

    const rec = await mgr.serializeMirrorIfLive(TASK);
    expect(rec).not.toBeNull();
    expect(rec!.cols).toBe(80);
    expect(rec!.rows).toBe(24);

    mgr.kill(TASK);
    await flushMicrotasks(200);
  });

  // A2 — terminalVersion default sentinel when not configured
  it("defaults terminalVersion to 'unknown' when expectedTerminalVersion is unset", async () => {
    const mgr = new PtyManager({
      spawn: spawn.fn,
      scrollbackStore: scrollback,
      headlessMirrorEnabled: true,
      snapshotStore: snapshot,
      // expectedTerminalVersion intentionally omitted.
      idleTimeoutMs: 60_000,
    });
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
    spawn.lastPty().__emit("data\r\n");
    await flushMicrotasks(50);

    const rec = await mgr.serializeMirrorIfLive(TASK);
    expect(rec).not.toBeNull();
    expect(rec!.terminalVersion).toBe("unknown");

    mgr.kill(TASK);
    await flushMicrotasks(200);
  });
});

describe("PtyManager — flushMirrorSnapshot (ADR-092 AC #3)", () => {
  let dir: string;
  let scrollback: ScrollbackStore;
  let snapshot: SnapshotStore;
  let spawn: ReturnType<typeof makeSpawn>;

  beforeEach(async () => {
    dir = fsSync.mkdtempSync(path.join(os.tmpdir(), "pty-flush-"));
    scrollback = new ScrollbackStore(dir, { maxBytesPerTask: 4096 });
    await scrollback.init();
    snapshot = new SnapshotStore(dir);
    await snapshot.init();
    spawn = makeSpawn();
  });

  afterEach(async () => {
    await scrollback.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  // A3.1 + A3.4
  it("writes a snapshot to disk WITHOUT disposing the mirror", async () => {
    const mgr = new PtyManager({
      spawn: spawn.fn,
      scrollbackStore: scrollback,
      headlessMirrorEnabled: true,
      snapshotStore: snapshot,
      expectedTerminalVersion: "5.5.0",
      idleTimeoutMs: 60_000,
    });
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
    spawn.lastPty().__emit("first-line\r\n");
    await flushMicrotasks(50);

    expect(await snapshot.has(TASK)).toBe(false);

    await mgr.flushMirrorSnapshot(TASK);

    expect(await snapshot.has(TASK)).toBe(true);
    const recFromDisk = await snapshot.read(TASK);
    expect(recFromDisk).not.toBeNull();
    expect(recFromDisk!.cols).toBe(120);

    // A3.4 — mirror still alive: new data must mirror, and a second
    // in-memory serialize returns a record whose data string differs
    // from the first (more rows present).
    const beforeData = recFromDisk!.data;
    spawn.lastPty().__emit("second-line\r\n");
    await flushMicrotasks(50);
    const live2 = await mgr.serializeMirrorIfLive(TASK);
    expect(live2).not.toBeNull();
    expect(live2!.data).not.toBe(beforeData);

    mgr.kill(TASK);
    await flushMicrotasks(200);
  });

  // A3.2
  it("is a no-op when no entry / no mirror / no snapshotStore", async () => {
    // No entry
    {
      const mgr = new PtyManager({
        spawn: spawn.fn,
        headlessMirrorEnabled: true,
        snapshotStore: snapshot,
      });
      await expect(mgr.flushMirrorSnapshot(TASK)).resolves.toBeUndefined();
      expect(await snapshot.has(TASK)).toBe(false);
    }
    // No mirror (flag off)
    {
      const mgr = new PtyManager({
        spawn: makeSpawn().fn,
        scrollbackStore: scrollback,
        idleTimeoutMs: 60_000,
      });
      mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
      await expect(mgr.flushMirrorSnapshot(TASK)).resolves.toBeUndefined();
      expect(await snapshot.has(TASK)).toBe(false);
      mgr.kill(TASK);
    }
    // No snapshotStore — constructor downgrades flag to off, so no
    // mirror is created and the call is a no-op via the !mirror branch.
    {
      const mgr = new PtyManager({
        spawn: makeSpawn().fn,
        scrollbackStore: scrollback,
        headlessMirrorEnabled: true,
        // snapshotStore intentionally omitted.
        idleTimeoutMs: 60_000,
      });
      mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
      await expect(mgr.flushMirrorSnapshot(TASK)).resolves.toBeUndefined();
      expect(await snapshot.has(TASK)).toBe(false);
      mgr.kill(TASK);
    }
  });

  // A3.3 — survives disk failure without throwing
  it("survives SnapshotStore.write failure without throwing", async () => {
    // Wrap snapshot.write to throw once.
    const original = snapshot.write.bind(snapshot);
    let writeCalls = 0;
    snapshot.write = async (taskId: string, payload: { cols: number; rows: number; data: string }): Promise<void> => {
      writeCalls++;
      if (writeCalls === 1) {
        throw new Error("simulated disk failure");
      }
      return original(taskId, payload);
    };

    const mgr = new PtyManager({
      spawn: spawn.fn,
      scrollbackStore: scrollback,
      headlessMirrorEnabled: true,
      snapshotStore: snapshot,
      expectedTerminalVersion: "5.5.0",
      idleTimeoutMs: 60_000,
    });
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
    spawn.lastPty().__emit("payload\r\n");
    await flushMicrotasks(50);

    // First call must NOT throw despite the underlying write failure.
    await expect(mgr.flushMirrorSnapshot(TASK)).resolves.toBeUndefined();
    expect(writeCalls).toBe(1);

    // Mirror is still alive — second flush succeeds via the wrapped
    // pass-through to the real write().
    await expect(mgr.flushMirrorSnapshot(TASK)).resolves.toBeUndefined();
    expect(writeCalls).toBe(2);
    expect(await snapshot.has(TASK)).toBe(true);

    mgr.kill(TASK);
    await flushMicrotasks(200);
  });
});

describe("PtyManager.attachCount (ADR-092 AC #5)", () => {
  let dir: string;
  let scrollback: ScrollbackStore;
  let snapshot: SnapshotStore;
  let spawn: ReturnType<typeof makeSpawn>;

  beforeEach(async () => {
    dir = fsSync.mkdtempSync(path.join(os.tmpdir(), "pty-attach-count-"));
    scrollback = new ScrollbackStore(dir, { maxBytesPerTask: 4096 });
    await scrollback.init();
    snapshot = new SnapshotStore(dir);
    await snapshot.init();
    spawn = makeSpawn();
  });

  afterEach(async () => {
    await scrollback.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("reflects connSubs.size across attach/detach lifecycles", async () => {
    const mgr = new PtyManager({
      spawn: spawn.fn,
      scrollbackStore: scrollback,
      headlessMirrorEnabled: true,
      snapshotStore: snapshot,
      idleTimeoutMs: 60_000,
    });
    expect(mgr.attachCount(TASK)).toBe(0);
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
    expect(mgr.attachCount(TASK)).toBe(0); // spawn doesn't attach

    const connA = { id: "A" };
    const connB = { id: "B" };
    mgr.attach(TASK, connA);
    expect(mgr.attachCount(TASK)).toBe(1);
    mgr.attach(TASK, connB);
    expect(mgr.attachCount(TASK)).toBe(2);

    mgr.detach(TASK, connA);
    expect(mgr.attachCount(TASK)).toBe(1);
    mgr.detach(TASK, connB);
    expect(mgr.attachCount(TASK)).toBe(0);

    mgr.kill(TASK);
    expect(mgr.attachCount(TASK)).toBe(0); // entry gone

    await flushMicrotasks(200);
  });

  it("detachAndCount returns post-detach count atomically", async () => {
    const mgr = new PtyManager({
      spawn: spawn.fn,
      scrollbackStore: scrollback,
      headlessMirrorEnabled: true,
      snapshotStore: snapshot,
      idleTimeoutMs: 60_000,
    });
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
    const connA = { id: "A" };
    const connB = { id: "B" };
    mgr.attach(TASK, connA);
    mgr.attach(TASK, connB);
    expect(mgr.attachCount(TASK)).toBe(2);

    const res1 = mgr.detachAndCount(TASK, connA);
    expect(res1.remainingAttachCount).toBe(1);
    expect(mgr.attachCount(TASK)).toBe(1);

    const res2 = mgr.detachAndCount(TASK, connB);
    expect(res2.remainingAttachCount).toBe(0);
    expect(mgr.attachCount(TASK)).toBe(0);

    // Detach of unknown conn is idempotent — count stays 0.
    const res3 = mgr.detachAndCount(TASK, { id: "ghost" });
    expect(res3.remainingAttachCount).toBe(0);

    mgr.kill(TASK);
    await flushMicrotasks(200);
  });
});
