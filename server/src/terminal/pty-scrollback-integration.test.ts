/*
 * pty-scrollback-integration.test.ts — Phase 2 integration coverage
 * (ADR-068-A1).
 *
 * Verifies the wiring between PtyManager and ScrollbackStore:
 *   - pty.onData → scrollbackStore.append (synchronous, persisted)
 *   - pty.kill → scrollbackStore.closeStream (FD lifecycle hook)
 *   - pty.pause/resume forwarded by PtyManager.pause/resume
 *   - Disabled mode (maxBytesPerTask=0) bypasses persistence cleanly
 *
 * Uses the same FakePty pattern as pty-manager.test.ts so the test
 * stays deterministic and native-binary-free.
 */

import { afterEach, beforeEach, describe, expect, it } from "vitest";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PtyManager, type PtyHandleApi, type PtySpawnFn } from "./pty-manager.js";
import { ScrollbackStore } from "./scrollback-store.js";

const TASK = "11111111-2222-3333-4444-555555555555";

interface FakePty extends PtyHandleApi {
  __paused: number;
  __resumed: number;
  __killed: boolean;
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

describe("PtyManager + ScrollbackStore integration (ADR-068-A1)", () => {
  let dir: string;
  let store: ScrollbackStore;
  let mgr: PtyManager;
  let spawn: ReturnType<typeof makeSpawn>;

  beforeEach(async () => {
    dir = fsSync.mkdtempSync(path.join(os.tmpdir(), "pty-scrollback-"));
    store = new ScrollbackStore(dir, { maxBytesPerTask: 4096 });
    await store.init();
    spawn = makeSpawn();
    mgr = new PtyManager({
      spawn: spawn.fn,
      idleTimeoutMs: 60_000,
      scrollbackStore: store,
    });
  });

  afterEach(async () => {
    mgr.killAll();
    await store.shutdown();
    await fs.rm(dir, { recursive: true, force: true });
  });

  it("pty.onData synchronously appends to scrollback file", async () => {
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
    spawn.lastPty().__emit("hello world\r\n");
    spawn.lastPty().__emit("ANSI:\x1b[31mred\x1b[0m\r\n");
    // Bytes are visible immediately (appendFileSync semantics).
    expect(await store.read(TASK)).toBe("hello world\r\nANSI:\x1b[31mred\x1b[0m\r\n");
  });

  it("pty.kill triggers scrollbackStore.closeStream (best-effort, idempotent)", async () => {
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
    spawn.lastPty().__emit("data");
    expect(await store.read(TASK)).toBe("data");

    mgr.kill(TASK);
    // closeStream is fire-and-forget; await microtasks then verify file
    // is still readable on disk (not deleted, just stream invalidated).
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    // iterate-2026-05-08 v0.8.7 AC-2: kill now also appends a shell-stopped
    // marker before closing the stream. The original "data" prefix is
    // preserved; the marker follows.
    const content = await store.read(TASK);
    expect(content).toContain("data");
    expect(content).toMatch(/──── shell stopped at \d{2}:\d{2}:\d{2} ────/);
  });

  it("pty.pause / pty.resume forwarded by manager", () => {
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
    const fake = spawn.lastPty();
    expect(fake.__paused).toBe(0);
    expect(fake.__resumed).toBe(0);

    mgr.pause(TASK);
    expect(fake.__paused).toBe(1);
    mgr.resume(TASK);
    expect(fake.__resumed).toBe(1);

    // Idempotent — calling on a non-existent task is a no-op.
    mgr.pause("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx");
    mgr.resume("xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx");
    expect(fake.__paused).toBe(1);
    expect(fake.__resumed).toBe(1);
  });

  it("disabled mode (maxBytesPerTask=0) bypasses persistence", async () => {
    const offDir = fsSync.mkdtempSync(path.join(os.tmpdir(), "pty-off-"));
    const offStore = new ScrollbackStore(offDir, { maxBytesPerTask: 0 });
    await offStore.init();
    const offMgr = new PtyManager({
      spawn: spawn.fn,
      idleTimeoutMs: 60_000,
      scrollbackStore: offStore,
    });
    offMgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
    spawn.lastPty().__emit("ignored");
    expect(await offStore.read(TASK)).toBe("");
    expect(await offStore.bytes(TASK)).toBe(0);
    expect(
      fsSync.existsSync(path.join(offDir, `${TASK}.log`)),
    ).toBe(false);

    offMgr.killAll();
    await offStore.shutdown();
    await fs.rm(offDir, { recursive: true, force: true });
  });

  it("survives scrollback append throwing — broadcast loop continues", async () => {
    // Phase-3 review fix (MEDIUM): inject a throwing ScrollbackStore so
    // the test actually verifies the try/catch around scrollbackStore.append
    // in pty-manager onData. Without this, the previous version was
    // vacuous.
    const throwingDir = await fs.mkdtemp(path.join(os.tmpdir(), "throwing-"));
    const baseStore = new ScrollbackStore(throwingDir, { maxBytesPerTask: 4096 });
    await baseStore.init();
    // Wrap append() to always throw.
    const throwingStore = Object.create(baseStore) as ScrollbackStore;
    Object.defineProperty(throwingStore, "append", {
      value: () => {
        throw new Error("simulated disk failure");
      },
    });

    const tmpSpawn = makeSpawn();
    const throwingMgr = new PtyManager({
      spawn: tmpSpawn.fn,
      idleTimeoutMs: 60_000,
      scrollbackStore: throwingStore,
    });

    const received: string[] = [];
    throwingMgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
    throwingMgr.subscribe(TASK, (data) => received.push(data));

    // The throwing append() must NOT prevent broadcast.
    tmpSpawn.lastPty().__emit("payload-after-throw");
    expect(received).toContain("payload-after-throw");

    throwingMgr.killAll();
    await baseStore.shutdown();
    await fs.rm(throwingDir, { recursive: true, force: true });
  });

  it("multi-byte UTF-8 payload appends faithfully through pty.onData", async () => {
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
    spawn.lastPty().__emit("Hellö 🚀");
    expect(await store.read(TASK)).toBe("Hellö 🚀");
  });

  // -------------------------------------------------------------------
  // AC-3a — pause/resume per-conn refcount (iterate-2026-05-05).
  //
  // Multi-tab replay-on-attach must not have one tab's resume()
  // unpause the pty for the other tab mid-replay. PtyManager guards
  // pty.pause / pty.resume on 0↔1 refcount transitions so concurrent
  // pause stakes from different conns are tracked independently.
  // -------------------------------------------------------------------

  it("AC-3a: pauseForConn refcount — two distinct conns, only one pty.pause / pty.resume", () => {
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
    const fake = spawn.lastPty();
    const connA = { id: "A" };
    const connB = { id: "B" };

    mgr.pauseForConn(TASK, connA);
    mgr.pauseForConn(TASK, connB);
    expect(fake.__paused).toBe(1); // 0→1 transition only

    mgr.resumeForConn(TASK, connA);
    expect(fake.__resumed).toBe(0); // refcount still 1 — connB holds stake

    mgr.resumeForConn(TASK, connB);
    expect(fake.__resumed).toBe(1); // 1→0 transition fires resume
  });

  it("AC-3a: pauseForConn is idempotent for the same conn", () => {
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
    const fake = spawn.lastPty();
    const connA = { id: "A" };

    mgr.pauseForConn(TASK, connA);
    mgr.pauseForConn(TASK, connA); // duplicate — no-op
    mgr.pauseForConn(TASK, connA); // duplicate — no-op
    expect(fake.__paused).toBe(1);

    mgr.resumeForConn(TASK, connA);
    expect(fake.__resumed).toBe(1);

    // Resume of a non-pausing conn is a silent no-op.
    mgr.resumeForConn(TASK, connA);
    expect(fake.__resumed).toBe(1);
  });

  it("AC-3a: detach() releases the conn's pause stake (force-evict cleanup)", () => {
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
    const fake = spawn.lastPty();
    const connA = { id: "A" };

    // connA attaches + holds a pause stake (mid-replay scenario).
    mgr.attach(TASK, connA);
    mgr.pauseForConn(TASK, connA);
    expect(fake.__paused).toBe(1);
    expect(fake.__resumed).toBe(0);

    // Watchdog (or graceful close) detaches connA — its stake must be
    // released or the pty stays paused forever.
    mgr.detach(TASK, connA);
    expect(fake.__resumed).toBe(1);
  });

  it("AC-3a: legacy pause(taskId) anonymous-token API still single-fires pty.pause", () => {
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
    const fake = spawn.lastPty();

    mgr.pause(TASK);
    mgr.pause(TASK); // duplicate anonymous — refcount idempotent
    expect(fake.__paused).toBe(1);

    mgr.resume(TASK);
    expect(fake.__resumed).toBe(1);
  });
});
