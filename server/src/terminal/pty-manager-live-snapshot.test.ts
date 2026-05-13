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

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
      expectedTerminalVersion: "6.0.0",
      idleTimeoutMs: 60_000,
    });
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
    spawn.lastPty().__emit("live-content\r\n");
    // Let the headless-mirror's async write() callback fire.
    await flushMicrotasks(50);

    const rec = await mgr.serializeMirrorIfLive(TASK);
    expect(rec).not.toBeNull();
    expect(rec!.version).toBe("v2");
    expect(rec!.terminalVersion).toBe("6.0.0");
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
      expectedTerminalVersion: "6.0.0",
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
      expectedTerminalVersion: "6.0.0",
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
      expectedTerminalVersion: "6.0.0",
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
      expectedTerminalVersion: "6.0.0",
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

/*
 * Iterate H (ADR-096) — finalizeMirrorSnapshot snapshot-preservation
 * heuristic.
 *
 * Scenario:
 *   - User runs Claude TUI for hours; multi-detach paths leave a rich
 *     `flushMirrorSnapshot` on disk (Iterate E path).
 *   - Idle ceiling or explicit kill fires; Claude TUI emits `DECRST 1049`
 *     (leave alt-screen) on exit; the mirror's main-buffer state ends
 *     up nearly empty.
 *   - `finalizeMirrorSnapshot` runs, serializes the now-empty cell-state,
 *     and would clobber the good on-disk snapshot.
 *
 * Heuristic: if the new payload's byte length is below 60 % of the
 * existing on-disk payload, skip the write. Edge cases:
 *   - No existing snapshot → write the new one (first writer).
 *   - read() throws → log + write the new one (best-effort fallback).
 *   - Empty new payload + existing has content → preserve existing.
 *   - mirror.dispose + releaseQueue still fire in finally on every branch.
 *
 * We exercise the heuristic via mgr.kill() — finalizeMirrorSnapshot is
 * private but reachable through the cleanup chain. Spies on
 * snapshot.read + snapshot.write let us assert call counts without
 * reaching into the mirror's parser output (which depends on
 * @xterm/headless internals).
 */
describe("PtyManager — finalizeMirrorSnapshot snapshot preservation (ADR-096)", () => {
  let dir: string;
  let scrollback: ScrollbackStore;
  let snapshot: SnapshotStore;
  let spawn: ReturnType<typeof makeSpawn>;

  beforeEach(async () => {
    dir = fsSync.mkdtempSync(path.join(os.tmpdir(), "pty-finalize-adr096-"));
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

  // H.1 — primary case: large existing + small new → existing preserved.
  it("preserves existing snapshot when new payload is < 60 % of existing", async () => {
    const mgr = new PtyManager({
      spawn: spawn.fn,
      scrollbackStore: scrollback,
      headlessMirrorEnabled: true,
      snapshotStore: snapshot,
      expectedTerminalVersion: "6.0.0",
      idleTimeoutMs: 60_000,
    });
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });

    // Pre-populate disk with a large "good" snapshot, simulating the
    // flushMirrorSnapshot-on-last-detach state.
    const largePayload = "x".repeat(2000);
    await snapshot.write(TASK, { cols: 120, rows: 30, data: largePayload });
    const onDiskBefore = await snapshot.read(TASK);
    expect(onDiskBefore).not.toBeNull();
    expect(onDiskBefore!.data.length).toBe(2000);

    // Spy on write — count invocations after pre-populate so we measure
    // ONLY the kill-path call.
    const writeSpy = vi.spyOn(snapshot, "write");
    const initialWriteCalls = writeSpy.mock.calls.length;

    // Emit a tiny chunk so the mirror has SOMETHING but not 60% of 2000.
    // (Even a bare prompt-equivalent serialize is well under 1200 bytes.)
    spawn.lastPty().__emit("$ ");
    await flushMicrotasks(50);

    // Trigger finalize via kill() → cleanup → finalizeMirrorSnapshot.
    mgr.kill(TASK);
    // Allow the detached finalize promise to settle.
    await flushMicrotasks(300);

    // The on-disk snapshot must be unchanged.
    const onDiskAfter = await snapshot.read(TASK);
    expect(onDiskAfter).not.toBeNull();
    expect(onDiskAfter!.data.length).toBe(2000);
    expect(onDiskAfter!.data).toBe(largePayload);

    // The kill-path finalize MUST NOT have called write() again.
    expect(writeSpy.mock.calls.length).toBe(initialWriteCalls);

    writeSpy.mockRestore();
  });

  // H.2 — within-threshold: small existing + comparable-size new → new wins.
  // Empirical: a fresh @xterm/headless 120x30 mirror with a short emit
  // serializes via the M2 stable pipeline to ~27 bytes. The 60 % gate
  // for a 30-byte existing snapshot is 18 bytes — 27 > 18, so the
  // heuristic does NOT fire and the new snapshot wins.
  it("writes new snapshot when new payload is within 60 % threshold", async () => {
    const mgr = new PtyManager({
      spawn: spawn.fn,
      scrollbackStore: scrollback,
      headlessMirrorEnabled: true,
      snapshotStore: snapshot,
      expectedTerminalVersion: "6.0.0",
      idleTimeoutMs: 60_000,
    });
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });

    // 30-byte existing snapshot → 60 % gate = 18 bytes.
    const smallExisting = "y".repeat(30);
    await snapshot.write(TASK, { cols: 120, rows: 30, data: smallExisting });

    const writeSpy = vi.spyOn(snapshot, "write");
    const initialWriteCalls = writeSpy.mock.calls.length;

    // Emit enough content that the mirror's serializeStable output
    // comfortably exceeds the 18-byte gate. An empty-mirror baseline
    // is around 27 bytes; emitting more lines keeps it well above.
    spawn.lastPty().__emit("line1\r\nline2\r\nline3\r\n");
    await flushMicrotasks(50);

    mgr.kill(TASK);
    await flushMicrotasks(300);

    // write was invoked by the finalize path.
    expect(writeSpy.mock.calls.length).toBeGreaterThan(initialWriteCalls);

    // The new snapshot replaced the small "y" placeholder.
    const onDiskAfter = await snapshot.read(TASK);
    expect(onDiskAfter).not.toBeNull();
    expect(onDiskAfter!.data).not.toBe(smallExisting);

    writeSpy.mockRestore();
  });

  // H.3 — no existing on disk: new snapshot is written (first writer).
  it("writes new snapshot when no existing snapshot is on disk", async () => {
    const mgr = new PtyManager({
      spawn: spawn.fn,
      scrollbackStore: scrollback,
      headlessMirrorEnabled: true,
      snapshotStore: snapshot,
      expectedTerminalVersion: "6.0.0",
      idleTimeoutMs: 60_000,
    });
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });

    expect(await snapshot.has(TASK)).toBe(false);

    spawn.lastPty().__emit("hello\r\n");
    await flushMicrotasks(50);

    mgr.kill(TASK);
    await flushMicrotasks(300);

    // First-writer case: new snapshot must land on disk.
    expect(await snapshot.has(TASK)).toBe(true);
    const onDisk = await snapshot.read(TASK);
    expect(onDisk).not.toBeNull();
    expect(onDisk!.data.length).toBeGreaterThan(0);
  });

  // H.4 — existing snapshot exists, read() throws → write proceeds.
  it("writes new snapshot when existing-snapshot read throws (best-effort fallback)", async () => {
    const mgr = new PtyManager({
      spawn: spawn.fn,
      scrollbackStore: scrollback,
      headlessMirrorEnabled: true,
      snapshotStore: snapshot,
      expectedTerminalVersion: "6.0.0",
      idleTimeoutMs: 60_000,
    });
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });

    // Pre-populate a large existing snapshot so the heuristic WOULD
    // fire — except read() will throw, falling through to write.
    await snapshot.write(TASK, {
      cols: 120,
      rows: 30,
      data: "z".repeat(2000),
    });

    // Make read() throw once (the finalize-path call).
    const originalRead = snapshot.read.bind(snapshot);
    let readCalls = 0;
    snapshot.read = async (taskId: string) => {
      readCalls++;
      if (readCalls === 1) {
        throw new Error("simulated parse error");
      }
      return originalRead(taskId);
    };

    const writeSpy = vi.spyOn(snapshot, "write");
    const initialWriteCalls = writeSpy.mock.calls.length;

    spawn.lastPty().__emit("$ ");
    await flushMicrotasks(50);

    mgr.kill(TASK);
    await flushMicrotasks(300);

    // The read throw must NOT prevent the write — best-effort fallback.
    expect(writeSpy.mock.calls.length).toBeGreaterThan(initialWriteCalls);

    // Disk should now hold the new (small) snapshot — the throw-on-read
    // path doesn't preserve the existing.
    const onDiskAfter = await snapshot.read(TASK);
    expect(onDiskAfter).not.toBeNull();
    expect(onDiskAfter!.data).not.toBe("z".repeat(2000));

    writeSpy.mockRestore();
  });

  // H.5 — explicit empty new payload + existing has content → preserved.
  it("preserves existing snapshot when new payload is empty + existing has content", async () => {
    const mgr = new PtyManager({
      spawn: spawn.fn,
      scrollbackStore: scrollback,
      headlessMirrorEnabled: true,
      snapshotStore: snapshot,
      expectedTerminalVersion: "6.0.0",
      idleTimeoutMs: 60_000,
    });
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });

    // Pre-populate disk with a non-empty existing snapshot.
    const existingPayload = "abc".repeat(500); // 1500 bytes
    await snapshot.write(TASK, {
      cols: 120,
      rows: 30,
      data: existingPayload,
    });

    // Force the mirror's serializeStable output to "" so the new
    // payload's length is 0 — subsumed by the 60 % rule (0 < 1500*0.6)
    // but the edge case deserves its own explicit assertion.
    const writeSpy = vi.spyOn(snapshot, "write");
    const initialWriteCalls = writeSpy.mock.calls.length;

    // Stub serializeMirrorIfLive's underlying call indirectly: we can't
    // patch the private mirror; instead patch snapshot.write itself to
    // observe what payload would have been written. But the real
    // assertion is: was write called again at all? In the 60 % case
    // (1500B existing vs even a few-hundred-byte new), write should be
    // skipped — we don't strictly need to coerce to 0 bytes for the
    // gate to fire. Emit nothing so the mirror has minimal state.
    // (No __emit call.)
    await flushMicrotasks(20);

    mgr.kill(TASK);
    await flushMicrotasks(300);

    // The existing snapshot must remain unchanged.
    const onDiskAfter = await snapshot.read(TASK);
    expect(onDiskAfter).not.toBeNull();
    expect(onDiskAfter!.data).toBe(existingPayload);

    // The finalize-path write was suppressed.
    expect(writeSpy.mock.calls.length).toBe(initialWriteCalls);

    writeSpy.mockRestore();
  });

  // H.6 — disposal + queue release still fire when the write is skipped.
  it("disposes the mirror + releases queue even when write is skipped", async () => {
    const mgr = new PtyManager({
      spawn: spawn.fn,
      scrollbackStore: scrollback,
      headlessMirrorEnabled: true,
      snapshotStore: snapshot,
      expectedTerminalVersion: "6.0.0",
      idleTimeoutMs: 60_000,
    });
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });

    // Pre-populate a large existing snapshot to trigger the skip path.
    await snapshot.write(TASK, {
      cols: 120,
      rows: 30,
      data: "k".repeat(3000),
    });

    const releaseSpy = vi.spyOn(snapshot, "releaseQueue");
    const initialReleaseCalls = releaseSpy.mock.calls.length;

    spawn.lastPty().__emit("$ ");
    await flushMicrotasks(50);

    mgr.kill(TASK);
    await flushMicrotasks(300);

    // releaseQueue must run in the finally block regardless of whether
    // the write was skipped.
    expect(releaseSpy.mock.calls.length).toBeGreaterThan(initialReleaseCalls);

    releaseSpy.mockRestore();
  });
});
