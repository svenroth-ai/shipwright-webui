/*
 * pty-manager-flush-preserve.test.ts — iterate-2026-07-12-mirror-flush-
 * preserve-gate.
 *
 * The RED-first regression guard for the flush-path history loss.
 *
 * Pre-fix, flushMirrorSnapshot (ADR-092 last-detach keep-alive path) wrote
 * UNCONDITIONALLY — no ADR-096 preservation gate. On the 2nd detach→reopen
 * cycle, a thin mirror (Claude TUI alt-screen exit) CLOBBERED the richer
 * on-disk snapshot a prior detach/finalize had written → next reopen showed
 * a BLANK terminal scrollback.
 *
 * These tests prove the shared gate now protects the flush path:
 *   - a thin flush PRESERVES the richer disk snapshot (RED-first);
 *   - a richer flush OVERWRITES a thin disk snapshot;
 *   - flush does NOT dispose the mirror even when the gate skips
 *     (CLAUDE.md rule 21 / ADR-092 — flush is keep-alive);
 *   - finalizeMirrorSnapshot is unchanged after the extraction (symmetry).
 *
 * FakePty + temp-dir SnapshotStore — no native pty / real @xterm wiring
 * (mirrors pty-manager-live-snapshot.test.ts).
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

const TASK = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

interface FakePty extends PtyHandleApi {
  __emit(data: string): void;
}

function createFakePty(): FakePty {
  const dataListeners: Array<(s: string) => void> = [];
  const exitListeners: Array<(e: { exitCode: number; signal?: number }) => void> = [];
  const fake: FakePty = {
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
      for (const l of exitListeners) l({ exitCode: 0 });
    },
    pause() {},
    resume() {},
    __emit(data) {
      for (const l of dataListeners) l(data);
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

async function settle(ms = 100): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

describe("flushMirrorSnapshot — ADR-096 preservation gate (regression guard)", () => {
  let dir: string;
  let scrollback: ScrollbackStore;
  let snapshot: SnapshotStore;
  let spawn: ReturnType<typeof makeSpawn>;

  beforeEach(async () => {
    dir = fsSync.mkdtempSync(path.join(os.tmpdir(), "flush-preserve-"));
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

  function makeMgr(): PtyManager {
    return new PtyManager({
      spawn: spawn.fn,
      scrollbackStore: scrollback,
      headlessMirrorEnabled: true,
      snapshotStore: snapshot,
      expectedTerminalVersion: "6.0.0",
      idleTimeoutMs: 60_000,
    });
  }

  // AC2 — RED-first on pre-fix main: pre-fix flushMirrorSnapshot writes
  // UNCONDITIONALLY, so the thin mirror clobbers the 2000-byte disk
  // snapshot and `onDiskAfter.data === largePayload` FAILS.
  it("PRESERVES a richer on-disk snapshot when the flushed mirror is thin", async () => {
    const mgr = makeMgr();
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });

    // Seed disk with a rich snapshot (simulates a prior good detach flush).
    const largePayload = "x".repeat(2000);
    await snapshot.write(TASK, { cols: 120, rows: 30, data: largePayload });

    // Mirror holds only a bare prompt → serializeStable is well under
    // 60 % of 2000 (~27 B empirically; same anchor as the finalize H.1 test).
    spawn.lastPty().__emit("$ ");
    await settle(50);

    await mgr.flushMirrorSnapshot(TASK);

    const onDiskAfter = await snapshot.read(TASK);
    expect(onDiskAfter).not.toBeNull();
    // THE RED-FIRST ASSERTION — fails on pre-fix main (unconditional write).
    expect(onDiskAfter!.data).toBe(largePayload);
    expect(onDiskAfter!.data.length).toBe(2000);

    mgr.kill(TASK);
    await settle(200);
  });

  // Symmetry with the "larger overwrites" gate branch: a richer flush
  // payload MUST replace a thin existing snapshot.
  it("OVERWRITES a thin on-disk snapshot when the flushed mirror is richer", async () => {
    const mgr = makeMgr();
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });

    // Seed a tiny existing snapshot (10 B) → 60 % gate = 6 B.
    const tinyExisting = "y".repeat(10);
    await snapshot.write(TASK, { cols: 120, rows: 30, data: tinyExisting });

    // Mirror serialize (empty baseline ~27 B, plus lines) comfortably
    // exceeds the 6 B gate → the write proceeds.
    spawn.lastPty().__emit("line1\r\nline2\r\nline3\r\n");
    await settle(50);

    await mgr.flushMirrorSnapshot(TASK);

    const onDiskAfter = await snapshot.read(TASK);
    expect(onDiskAfter).not.toBeNull();
    expect(onDiskAfter!.data).not.toBe(tinyExisting);
    expect(onDiskAfter!.data.length).toBeGreaterThan(tinyExisting.length);

    mgr.kill(TASK);
    await settle(200);
  });

  // CLAUDE.md rule 21 / ADR-092: flush is keep-alive — the mirror must
  // survive EVEN when the preservation gate SKIPS the write.
  it("does NOT dispose the mirror when the gate skips the write (rule 21)", async () => {
    const mgr = makeMgr();
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });

    await snapshot.write(TASK, { cols: 120, rows: 30, data: "x".repeat(2000) });
    spawn.lastPty().__emit("$ ");
    await settle(50);

    await mgr.flushMirrorSnapshot(TASK); // gate SKIPS (thin < 60 %)

    // Mirror is still live: serializeMirrorIfLive returns a record, and a
    // fresh emit mirrors (a disposed mirror would return null / not update).
    const live = await mgr.serializeMirrorIfLive(TASK);
    expect(live).not.toBeNull();
    const before = live!.data;

    spawn.lastPty().__emit("more-content-after-flush\r\n");
    await settle(50);
    const live2 = await mgr.serializeMirrorIfLive(TASK);
    expect(live2).not.toBeNull();
    expect(live2!.data).not.toBe(before);

    mgr.kill(TASK);
    await settle(200);
  });

  // Symmetry: finalizeMirrorSnapshot behaves identically after the
  // extraction — thin finalize payload still preserves a rich disk snapshot.
  it("finalizeMirrorSnapshot still preserves a richer snapshot after extraction (symmetry)", async () => {
    const mgr = makeMgr();
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });

    const largePayload = "z".repeat(2500);
    await snapshot.write(TASK, { cols: 120, rows: 30, data: largePayload });

    spawn.lastPty().__emit("$ ");
    await settle(50);

    // Finalize fires via kill() → cleanup → finalizeMirrorSnapshot.
    mgr.kill(TASK);
    await settle(300);

    const onDiskAfter = await snapshot.read(TASK);
    expect(onDiskAfter).not.toBeNull();
    expect(onDiskAfter!.data).toBe(largePayload);
  });
});
