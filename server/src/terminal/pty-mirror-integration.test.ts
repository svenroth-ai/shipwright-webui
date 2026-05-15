/*
 * pty-mirror-integration.test.ts — Iterate A / ADR-088.
 *
 * Verifies PtyManager + HeadlessMirror + SnapshotStore wiring:
 *   - flag-off path: zero behavior change (no in-memory mirror, no
 *     snapshot file). This is acceptance criterion #1 of the iterate.
 *   - flag-on path: pty.onData feeds the mirror, pty.kill finalises a
 *     snapshot file alongside the legacy scrollback. AC #2.
 *   - flag-on + resize: dimensions propagate to the mirror, snapshot
 *     header records the LATEST cols/rows.
 *   - flag-on + memory governance: idle/disposed tasks have no live
 *     mirror after kill (mirror.dispose() runs). AC #5.
 *
 * FakePty pattern matches pty-scrollback-integration.test.ts.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PtyManager, type PtyHandleApi, type PtySpawnFn } from "./pty-manager.js";
import { ScrollbackStore } from "./scrollback-store.js";
import { SnapshotStore, parseSnapshotEnvelope } from "./snapshot-store.js";

const TASK = "11111111-2222-3333-4444-555555555555";

interface FakePty extends PtyHandleApi {
  __paused: number;
  __resumed: number;
  __killed: boolean;
  __lastResize: { cols: number; rows: number } | null;
  __emit(data: string): void;
  __exit(exitCode: number, signal?: number): void;
}

function createFakePty(): FakePty {
  const dataListeners: Array<(s: string) => void> = [];
  const exitListeners: Array<(e: { exitCode: number; signal?: number }) => void> = [];
  const fake: FakePty = {
    __paused: 0,
    __resumed: 0,
    __killed: false,
    __lastResize: null,
    onData(cb) {
      dataListeners.push(cb);
      return { dispose() {} };
    },
    onExit(cb) {
      exitListeners.push(cb);
      return { dispose() {} };
    },
    write() {},
    resize(cols, rows) {
      fake.__lastResize = { cols, rows };
    },
    kill() {
      fake.__killed = true;
      for (const l of exitListeners) l({ exitCode: 0 });
    },
    pause() {
      fake.__paused++;
    },
    resume() {
      fake.__resumed++;
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

/** Wait for the detached finalize promise to resolve. */
async function flushMicrotasks(ms = 100): Promise<void> {
  await new Promise((r) => setTimeout(r, ms));
}

describe("PtyManager + HeadlessMirror integration (ADR-088 Iterate A)", () => {
  let dir: string;
  let scrollback: ScrollbackStore;
  let snapshot: SnapshotStore;
  let spawn: ReturnType<typeof makeSpawn>;

  beforeEach(async () => {
    dir = fsSync.mkdtempSync(path.join(os.tmpdir(), "pty-mirror-"));
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

  // ----------- AC #1 — flag OFF path is a no-op -------------------------

  describe("flag OFF (default) — zero behavior change", () => {
    it("does not write a snapshot file when headlessMirrorEnabled=false", async () => {
      const mgr = new PtyManager({
        spawn: spawn.fn,
        scrollbackStore: scrollback,
        // No headlessMirrorEnabled / snapshotStore.
        idleTimeoutMs: 60_000,
      });
      mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
      spawn.lastPty().__emit("hello world\r\n");
      mgr.kill(TASK);
      await flushMicrotasks();
      expect(await snapshot.has(TASK)).toBe(false);
      // Legacy scrollback still has the data.
      const replay = await scrollback.read(TASK);
      expect(replay).toContain("hello world");
    });

    it("does not write a snapshot when flag-on but snapshotStore omitted", async () => {
      const mgr = new PtyManager({
        spawn: spawn.fn,
        scrollbackStore: scrollback,
        headlessMirrorEnabled: true,
        // snapshotStore intentionally omitted — constructor MUST treat
        // this as flag-off so misconfiguration cannot leak Terminal
        // instances without a persistence path.
        idleTimeoutMs: 60_000,
      });
      mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
      spawn.lastPty().__emit("hello world\r\n");
      mgr.kill(TASK);
      await flushMicrotasks();
      expect(await snapshot.has(TASK)).toBe(false);
    });
  });

  // ----------- Iterate L — isAltBufferActive --------------------------
  //
  // PtyManager.isAltBufferActive(taskId) proxies to
  // HeadlessMirror.isAltBufferActive(), which reads
  // `term.buffer.active.type === "alternate"`. Used by the /tasks API
  // augmentation to derive the client-facing `altScreenActive` field
  // that gates the Resume CTA (hidden while a TUI is foregrounded).

  describe("Iterate L — isAltBufferActive", () => {
    it("returns false for a task with no live pty", () => {
      const mgr = new PtyManager({
        spawn: spawn.fn,
        scrollbackStore: scrollback,
        headlessMirrorEnabled: true,
        snapshotStore: snapshot,
        idleTimeoutMs: 60_000,
      });
      expect(mgr.isAltBufferActive(TASK)).toBe(false);
    });

    it("returns false for a task with mirror disabled (flag-off path)", async () => {
      const mgr = new PtyManager({
        spawn: spawn.fn,
        scrollbackStore: scrollback,
        // No headlessMirrorEnabled — entry.mirror is null.
        idleTimeoutMs: 60_000,
      });
      mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
      spawn.lastPty().__emit("hello\r\n");
      await flushMicrotasks(50);
      expect(mgr.isAltBufferActive(TASK)).toBe(false);
    });

    it("flips false→true on DECSET 1049 and back on DECRST 1049", async () => {
      const mgr = new PtyManager({
        spawn: spawn.fn,
        scrollbackStore: scrollback,
        headlessMirrorEnabled: true,
        snapshotStore: snapshot,
        idleTimeoutMs: 60_000,
      });
      mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });

      // Phase 1 — normal buffer (just a shell prompt).
      spawn.lastPty().__emit("PS> ");
      await flushMicrotasks(50);
      expect(mgr.isAltBufferActive(TASK)).toBe(false);

      // Phase 2 — enter alt-screen (Claude / vim / htop typical signal).
      spawn.lastPty().__emit("\x1b[?1049h");
      spawn.lastPty().__emit("TUI content\r\n");
      await flushMicrotasks(50);
      expect(mgr.isAltBufferActive(TASK)).toBe(true);

      // Phase 3 — exit alt-screen (TUI closed cleanly).
      spawn.lastPty().__emit("\x1b[?1049l");
      await flushMicrotasks(50);
      expect(mgr.isAltBufferActive(TASK)).toBe(false);
    });
  });

  // ----------- Iterate M — getLastPtyDataAt ----------------------------
  //
  // PtyManager.getLastPtyDataAt(taskId) returns the epoch-ms timestamp of
  // the most recent pty.onData chunk, or `null` if the pty hasn't emitted
  // anything yet or no entry exists for the task. Used by the /tasks API
  // augmentation to derive the client-facing `lastPtyDataAt` field that
  // (combined with `firstJsonlObservedAt` + a 15 s window) gates the
  // Resume CTA in BOTH alt-screen and main-buffer modes — the
  // ADR-098-broken assumption that altScreenActive==Claude-foreground no
  // longer holds with NO_FLICKER=1 default-on.

  describe("Iterate M — getLastPtyDataAt", () => {
    it("returns null for a task with no live pty", () => {
      const mgr = new PtyManager({
        spawn: spawn.fn,
        scrollbackStore: scrollback,
        headlessMirrorEnabled: true,
        snapshotStore: snapshot,
        idleTimeoutMs: 60_000,
      });
      expect(mgr.getLastPtyDataAt(TASK)).toBeNull();
    });

    it("returns null immediately after spawn (before first onData)", () => {
      const mgr = new PtyManager({
        spawn: spawn.fn,
        scrollbackStore: scrollback,
        headlessMirrorEnabled: true,
        snapshotStore: snapshot,
        idleTimeoutMs: 60_000,
      });
      mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
      // No __emit() yet — cold-pty window.
      expect(mgr.getLastPtyDataAt(TASK)).toBeNull();
    });

    it("bumps to a near-now timestamp on first pty.onData chunk", async () => {
      const mgr = new PtyManager({
        spawn: spawn.fn,
        scrollbackStore: scrollback,
        headlessMirrorEnabled: true,
        snapshotStore: snapshot,
        idleTimeoutMs: 60_000,
      });
      mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
      const before = Date.now();
      spawn.lastPty().__emit("hello\r\n");
      await flushMicrotasks(20);
      const after = Date.now();
      const ts = mgr.getLastPtyDataAt(TASK);
      expect(ts).not.toBeNull();
      expect(ts!).toBeGreaterThanOrEqual(before);
      expect(ts!).toBeLessThanOrEqual(after + 50); // allow a small grace
    });

    it("updates monotonically on subsequent chunks", async () => {
      const mgr = new PtyManager({
        spawn: spawn.fn,
        scrollbackStore: scrollback,
        headlessMirrorEnabled: true,
        snapshotStore: snapshot,
        idleTimeoutMs: 60_000,
      });
      mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
      spawn.lastPty().__emit("first\r\n");
      await flushMicrotasks(20);
      const t1 = mgr.getLastPtyDataAt(TASK);
      // Tiny pause so the wall clock advances ≥1ms even on fast hardware.
      await new Promise((r) => setTimeout(r, 5));
      spawn.lastPty().__emit("second\r\n");
      await flushMicrotasks(20);
      const t2 = mgr.getLastPtyDataAt(TASK);
      expect(t1).not.toBeNull();
      expect(t2).not.toBeNull();
      expect(t2!).toBeGreaterThanOrEqual(t1!);
    });

    it("returns null after the pty is killed (entry removed)", async () => {
      const mgr = new PtyManager({
        spawn: spawn.fn,
        scrollbackStore: scrollback,
        headlessMirrorEnabled: true,
        snapshotStore: snapshot,
        idleTimeoutMs: 60_000,
      });
      mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
      spawn.lastPty().__emit("hello\r\n");
      await flushMicrotasks(20);
      expect(mgr.getLastPtyDataAt(TASK)).not.toBeNull();
      await mgr.kill(TASK);
      expect(mgr.getLastPtyDataAt(TASK)).toBeNull();
    });

    it("is independent of buffer type — bumps in BOTH normal and alt-screen", async () => {
      // Iterate M motivation: ADR-098 made Claude render in main-buffer
      // (NO_FLICKER=1 default), so altScreenActive stays false while
      // Claude streams. lastPtyDataAt must work in BOTH modes.
      const mgr = new PtyManager({
        spawn: spawn.fn,
        scrollbackStore: scrollback,
        headlessMirrorEnabled: true,
        snapshotStore: snapshot,
        idleTimeoutMs: 60_000,
      });
      mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
      // Phase 1: emit in normal buffer.
      spawn.lastPty().__emit("PS> hello\r\n");
      await flushMicrotasks(20);
      const tNormal = mgr.getLastPtyDataAt(TASK);
      expect(tNormal).not.toBeNull();
      expect(mgr.isAltBufferActive(TASK)).toBe(false);
      await new Promise((r) => setTimeout(r, 5));
      // Phase 2: enter alt-screen, emit again.
      spawn.lastPty().__emit("\x1b[?1049h");
      spawn.lastPty().__emit("TUI content\r\n");
      await flushMicrotasks(20);
      const tAlt = mgr.getLastPtyDataAt(TASK);
      expect(tAlt).not.toBeNull();
      expect(mgr.isAltBufferActive(TASK)).toBe(true);
      expect(tAlt!).toBeGreaterThanOrEqual(tNormal!);
    });
  });

  // ----------- AC #2 — flag ON shadow-writes snapshot -------------------

  describe("flag ON — shadow-writes snapshot on kill", () => {
    it("writes a snapshot alongside legacy scrollback on kill", async () => {
      const mgr = new PtyManager({
        spawn: spawn.fn,
        scrollbackStore: scrollback,
        headlessMirrorEnabled: true,
        snapshotStore: snapshot,
        idleTimeoutMs: 60_000,
      });
      mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
      spawn.lastPty().__emit("hello world\r\n");
      // Microtask yield so the async mirror.write() callback runs.
      await flushMicrotasks(50);
      mgr.kill(TASK);
      // Detached finalize promise — give it time to complete the M2 cycle.
      await flushMicrotasks(200);

      expect(await snapshot.has(TASK)).toBe(true);
      const rec = await snapshot.read(TASK);
      expect(rec).not.toBeNull();
      expect(rec!.version).toBe("v2");
      expect(rec!.cols).toBe(120);
      expect(rec!.rows).toBe(30);
      // Legacy scrollback also intact.
      const replay = await scrollback.read(TASK);
      expect(replay).toContain("hello world");
    });

    it("writes a snapshot on natural pty exit (not just explicit kill)", async () => {
      const mgr = new PtyManager({
        spawn: spawn.fn,
        scrollbackStore: scrollback,
        headlessMirrorEnabled: true,
        snapshotStore: snapshot,
        idleTimeoutMs: 60_000,
      });
      mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
      spawn.lastPty().__emit("output\r\n");
      await flushMicrotasks(50);
      // Natural shell exit — closing flag remains false; snapshot still
      // captured (cleanup runs regardless of the closing flag).
      spawn.lastPty().__exit(0);
      await flushMicrotasks(200);
      expect(await snapshot.has(TASK)).toBe(true);
    });

    it("snapshot header captures the LATEST cols/rows after resize", async () => {
      const mgr = new PtyManager({
        spawn: spawn.fn,
        scrollbackStore: scrollback,
        headlessMirrorEnabled: true,
        snapshotStore: snapshot,
        idleTimeoutMs: 60_000,
      });
      mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
      spawn.lastPty().__emit("before resize\r\n");
      await flushMicrotasks(50);
      mgr.resize(TASK, 80, 24);
      expect(spawn.lastPty().__lastResize).toEqual({ cols: 80, rows: 24 });
      spawn.lastPty().__emit("after resize\r\n");
      await flushMicrotasks(50);
      mgr.kill(TASK);
      await flushMicrotasks(200);

      const rec = await snapshot.read(TASK);
      expect(rec).not.toBeNull();
      expect(rec!.cols).toBe(80);
      expect(rec!.rows).toBe(24);
    });

    it("snapshot file uses the v2 envelope shape parseable by parseSnapshotEnvelope", async () => {
      const mgr = new PtyManager({
        spawn: spawn.fn,
        scrollbackStore: scrollback,
        headlessMirrorEnabled: true,
        snapshotStore: snapshot,
        idleTimeoutMs: 60_000,
      });
      mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
      spawn.lastPty().__emit("payload\r\n");
      await flushMicrotasks(50);
      mgr.kill(TASK);
      await flushMicrotasks(200);

      const filePath = path.join(dir, `${TASK}.snapshot`);
      const raw = fsSync.readFileSync(filePath, "utf8");
      // Round-trip parse — confirms producer's bytes round-trip through
      // the parser. This is the producer→file→consumer boundary probe.
      const rec = parseSnapshotEnvelope(raw);
      expect(rec.version).toBe("v2");
      expect(rec.cols).toBe(120);
      expect(rec.rows).toBe(30);
    });
  });

  // ----------- AC #5 — memory governance --------------------------------

  describe("memory governance — no live mirror after kill", () => {
    it("getLiveTaskIds is empty after kill", async () => {
      const mgr = new PtyManager({
        spawn: spawn.fn,
        scrollbackStore: scrollback,
        headlessMirrorEnabled: true,
        snapshotStore: snapshot,
        idleTimeoutMs: 60_000,
      });
      mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
      expect(mgr.getLiveTaskIds().has(TASK)).toBe(true);
      mgr.kill(TASK);
      // Synchronous cleanup runs in onExit → entries removed immediately.
      expect(mgr.getLiveTaskIds().has(TASK)).toBe(false);
      // Finalize-snapshot Promise may still be pending; that's OK
      // because it captured the mirror reference in its closure. The
      // entries map (the only "live-mirror" surface) is cleared.
      await flushMicrotasks(200);
    });
  });
});
