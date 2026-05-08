/*
 * pty-manager.shell-stopped-marker.test.ts — iterate v0.8.7 AC-2
 *
 * On every intentional pty kill (kill(taskId) OR idle-ceiling timer firing),
 * a single dim-grey ANSI marker frame is appended to the disk-scrollback so
 * the user sees a structured separator between historical "shell lifetimes"
 * during replay-on-attach.
 *
 * Per external plan review (gemini medium): the marker is appended INSIDE
 * the pty.onExit handler — AFTER all dying-process flush bytes have been
 * captured by scrollback. A `closing` flag distinguishes "intentional kill"
 * (we wrote the marker) from "shell exited naturally" (no marker).
 *
 * Idempotency: duplicate kill calls produce one marker total (closing-flag
 * dedupe — second kill sees closing already true, skips append).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { PtyManager, type PtyHandleApi, type PtySpawnFn } from "./pty-manager.js";
import { ScrollbackStore } from "./scrollback-store.js";

const TASK = "33333333-4444-5555-6666-777777777777";

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
      // Emit exit synchronously so the manager's onExit handler runs
      // INSIDE the kill() call frame — matches the closing-flag-checked-
      // before-pty.kill() ordering invariant.
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

const MARKER_PATTERN = /\x1b\[2m──── shell stopped at \d{2}:\d{2}:\d{2} ────\x1b\[m/;

describe("AC-2 — shell-stopped marker appended to disk scrollback on intentional kill", () => {
  let dir: string;
  let store: ScrollbackStore;
  let mgr: PtyManager;
  let spawn: ReturnType<typeof makeSpawn>;

  beforeEach(async () => {
    dir = fsSync.mkdtempSync(path.join(os.tmpdir(), "pty-marker-"));
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

  it("kill(taskId) writes one marker line to scrollback", async () => {
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
    spawn.lastPty().__emit("hello\r\n");
    mgr.kill(TASK);

    // closeStream is fire-and-forget; pump microtasks to let writes flush.
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const content = await store.read(TASK);
    expect(content).toMatch(MARKER_PATTERN);
    // Exactly one marker line — not two from any duplicate path.
    expect(content.match(/──── shell stopped at/g)?.length ?? 0).toBe(1);
  });

  it("idle-ceiling kill writes one marker line to scrollback", async () => {
    vi.useFakeTimers();
    const idleMgr = new PtyManager({
      spawn: spawn.fn,
      idleTimeoutMs: 1000, // short for test
      scrollbackStore: store,
    });
    try {
      idleMgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
      spawn.lastPty().__emit("hello\r\n");

      // Trip idle-ceiling without further activity.
      vi.advanceTimersByTime(1100);

      // Pump async work + the final microtasks for the kill→onExit→append path.
      await vi.runAllTimersAsync();
      vi.useRealTimers();
      await new Promise((r) => setImmediate(r));
      await new Promise((r) => setImmediate(r));

      const content = await store.read(TASK);
      expect(content).toMatch(MARKER_PATTERN);
      expect(content.match(/──── shell stopped at/g)?.length ?? 0).toBe(1);
    } finally {
      idleMgr.killAll();
      vi.useRealTimers();
    }
  });

  it("duplicate kill(taskId) writes exactly ONE marker (closing-flag dedupe)", async () => {
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
    spawn.lastPty().__emit("hello\r\n");

    // Two calls in quick succession — second is no-op since first cleaned up.
    mgr.kill(TASK);
    mgr.kill(TASK);

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const content = await store.read(TASK);
    expect(content.match(/──── shell stopped at/g)?.length ?? 0).toBe(1);
  });

  it("shell-exited-naturally (no kill called) does NOT write marker", async () => {
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
    spawn.lastPty().__emit("hello\r\n");

    // Simulate the pty exiting on its own (e.g. user typed `exit`).
    spawn.lastPty().__exit(0);

    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const content = await store.read(TASK);
    expect(content).toBe("hello\r\n");
    expect(content).not.toMatch(MARKER_PATTERN);
  });

  it("marker uses dim-grey ANSI styling + box-drawing chars", async () => {
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
    mgr.kill(TASK);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));

    const content = await store.read(TASK);
    // ESC [2m  =  SGR dim attribute. ESC [m  =  reset.
    expect(content).toContain("\x1b[2m");
    expect(content).toContain("\x1b[m");
    // Heavy horizontal box-drawing char U+2500 ─ — repeated 4 times each side.
    expect(content).toContain("──── shell stopped at");
    expect(content).toContain("────");
  });

  it("scrollbackBytes accounting reflects multibyte UTF-8 marker content", async () => {
    mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
    spawn.lastPty().__emit("hi\r\n");
    const beforeBytes = await store.bytes(TASK);
    mgr.kill(TASK);
    await new Promise((r) => setImmediate(r));
    await new Promise((r) => setImmediate(r));
    const afterBytes = await store.bytes(TASK);
    // Marker contains 8× U+2500 (3 bytes UTF-8 each) + ANSI + ASCII text.
    // afterBytes - beforeBytes should equal the marker's UTF-8 byte length.
    const delta = afterBytes - beforeBytes;
    // \r\n + ESC[2m + "──── shell stopped at HH:MM:SS ────" + ESC[m + \r\n
    // = 2 + 4 + (8×3 box-drawing + 27 ascii literal incl. 2 spaces) + 3 + 2
    // = 62 bytes
    expect(delta).toBeGreaterThanOrEqual(60);
    expect(delta).toBeLessThanOrEqual(65);
  });
});
