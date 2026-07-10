/*
 * ws-replay-disk-fallback.test.ts — F02 / D02 regression guards.
 *
 * FROZEN GUARD SET — author ≠ fixer (must-not-modify); the fix agent may NOT
 * weaken these. GUARD 1 is RED on pre-fix `main` for the DEFECT reason: the
 * empty fresh-mirror replay shadows the persisted disk snapshot.
 *
 * DEFECT (F02, HIGH — ws-upgrade-handler.ts:269-277): `buildLiveHandlers`
 * spawns the ensure-or-create pty (NEW empty HeadlessMirror) BEFORE
 * `resolveReplaySnapshot`, whose `serializeMirrorIfLive` returns a truthy
 * empty record for the fresh mirror, so `tryReadSnapshot` (disk) is never
 * reached — after any pty death the rich `<taskId>.snapshot` is never
 * replayed (blank shell on reopen).
 *
 * Uses a REAL PtyManager + REAL HeadlessMirror + REAL SnapshotStore so the
 * production spawn→resolve ordering is genuinely under test (the mock-based
 * ws-upgrade-handler.test.ts cannot observe it). Native-pty-free: only the
 * OS pty is faked via PtySpawnFn.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "node:fs/promises";
import * as fsSync from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
  buildWsHandlers,
  type ValidatedWsUpgradeContext,
} from "./ws-upgrade-handler.js";
import {
  PtyManager,
  type PtyHandleApi,
  type PtySpawnFn,
} from "./pty-manager.js";
import { SnapshotStore } from "./snapshot-store.js";
import { HeadlessMirror } from "./headless-mirror.js";
import {
  makeStore,
  makeTask,
  makeWs,
  readSent,
  type MockWs,
} from "./ws-upgrade-handler.fixtures.js";

const TASK = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

// Fake pty (native-binary-free). The mirror + store are the REAL impls.
interface FakePty extends PtyHandleApi { __emit(data: string): void }
function createFakePty(): FakePty {
  const dataL: Array<(s: string) => void> = [];
  const exitL: Array<(e: { exitCode: number }) => void> = [];
  return {
    onData: (cb) => (dataL.push(cb), { dispose() {} }),
    onExit: (cb) => (exitL.push(cb), { dispose() {} }),
    write() {},
    resize() {},
    kill: () => exitL.forEach((l) => l({ exitCode: 0 })),
    pause() {},
    resume() {},
    __emit: (d) => dataL.forEach((l) => l(d)),
  };
}
function makeSpawn(): { fn: PtySpawnFn; lastPty: () => FakePty } {
  let last: FakePty | undefined;
  return {
    fn: () => (last = createFakePty()),
    lastPty: () => {
      if (!last) throw new Error("no pty spawned");
      return last;
    },
  };
}
// Real-timer delay so the headless parser settles after emitting bytes.
const delay = (ms = 250): Promise<void> => new Promise((r) => setTimeout(r, ms));
function replayFrame(ws: MockWs): Record<string, unknown> | undefined {
  return readSent(ws).find(
    (s) => (s as { type?: string }).type === "replay_snapshot",
  ) as Record<string, unknown> | undefined;
}

// Deterministically await the async replay path's COMPLETION. `onOpen` is
// fire-and-forget (void return, internal `void (async…)()` IIFE), so we poll
// for its end-of-replay signal — the emitted replay_snapshot frame (later
// sends are synchronous within the IIFE). Throws on timeout (no masked pass);
// replaces fixed post-onOpen sleeps so assertions run AFTER replay completes.
async function awaitReplay(ws: MockWs, timeoutMs = 4000): Promise<void> {
  const start = Date.now();
  while (!replayFrame(ws)) {
    if (Date.now() - start > timeoutMs) {
      throw new Error("awaitReplay: no replay_snapshot frame within timeout");
    }
    await new Promise((r) => setTimeout(r, 10));
  }
}

describe("F02/D02 — disk-snapshot replay reachability in the live WS branch", () => {
  let dir: string;
  let snapshot: SnapshotStore;
  const managers: PtyManager[] = [];

  beforeEach(async () => {
    dir = fsSync.mkdtempSync(path.join(os.tmpdir(), "d02-disk-fallback-"));
    snapshot = new SnapshotStore(dir);
    await snapshot.init();
    managers.length = 0;
  });

  afterEach(async () => {
    for (const m of managers) {
      try {
        await m.kill(TASK);
      } catch {
        /* best-effort */
      }
    }
    vi.restoreAllMocks();
    await fs.rm(dir, { recursive: true, force: true });
  });

  /** REAL PtyManager (headless mirror + disk snapshot wired) + its fake pty. */
  function newMgr(expectedTerminalVersion: string): {
    mgr: PtyManager;
    lastPty: () => FakePty;
  } {
    const spawn = makeSpawn();
    const mgr = new PtyManager({
      spawn: spawn.fn,
      headlessMirrorEnabled: true,
      snapshotStore: snapshot,
      expectedTerminalVersion,
      idleTimeoutMs: 60_000,
    });
    managers.push(mgr);
    return { mgr, lastPty: spawn.lastPty };
  }

  function makeRealCtx(
    over: Partial<ValidatedWsUpgradeContext> & { ptyManager: PtyManager },
  ): ValidatedWsUpgradeContext {
    return {
      taskId: TASK,
      task: makeTask({ taskId: TASK, state: "active" }),
      trustedCwd: process.cwd(),
      store: makeStore() as unknown as ValidatedWsUpgradeContext["store"],
      snapshotStore: snapshot,
      retentionDays: 1,
      scrollbackDirHint: "<scrollback>",
      resolveShell: () => "bash",
      ...over,
    };
  }

  // GUARD 1 — independent RED integration test (the F02 probe, promoted).
  it(
    "GUARD 1 (RED on main): after pty death, WS re-attach replays the DISK " +
      "snapshot (marker present), not the empty fresh-mirror snapshot",
    async () => {
      const MARKER = "HIST_MARKER_D02_GUARD1_9F3A";
      // Process A: a live pty emits history, flushMirrorSnapshot persists it.
      const a = newMgr("6.0.0");
      a.mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
      a.lastPty().__emit(`${MARKER}\r\n`);
      await delay(120);
      await a.mgr.flushMirrorSnapshot(TASK);
      const onDisk = await snapshot.read(TASK);
      expect(onDisk, "process A must persist a disk snapshot").not.toBeNull();
      expect(
        onDisk!.data.includes(MARKER),
        "disk snapshot must carry the rich terminal history (marker)",
      ).toBe(true);
      const diskVersion = onDisk!.terminalVersion;
      // Tear down process A's pty so no live mirror leaks into process B.
      await a.mgr.kill(TASK);
      await delay(120);
      expect((await snapshot.read(TASK))!.data.includes(MARKER)).toBe(true);
      // Process B: FRESH PtyManager, SAME SnapshotStore (server-restart). No
      // live pty → spawn() precedes resolve() exactly as production does.
      const b = newMgr(diskVersion);
      expect(b.mgr.get(TASK), "process B starts with no live pty").toBeUndefined();
      const ws = makeWs();
      buildWsHandlers(
        makeRealCtx({
          ptyManager: b.mgr,
          expectedTerminalVersion: diskVersion,
          task: makeTask({ taskId: TASK, state: "active" }),
        }),
      ).onOpen?.({} as Event, ws as never);
      await awaitReplay(ws);
      const frame = replayFrame(ws);
      expect(frame, "a replay_snapshot envelope must be emitted").toBeDefined();
      // Disk snapshot is STILL present at resolve time — merely shadowed.
      expect((await snapshot.read(TASK))!.data.includes(MARKER)).toBe(true);
      // RED ANCHOR — pre-fix the emitted replay is the empty fresh-mirror
      // serialize (marker absent): serializeMirrorIfLive shadows tryReadSnapshot.
      // Post-fix (resolve disk BEFORE spawn when no live pty) it equals disk.
      expect(
        (frame!.data as string).includes(MARKER),
        "F02: replay_snapshot must carry the persisted disk history, not " +
          "the blank fresh-mirror state",
      ).toBe(true);
    },
  );

  // GUARD 2(a) — live-first precedence preserved (ADR-092). Stays GREEN.
  it(
    "GUARD 2a (stays GREEN): with a LIVE pty, resolve returns the live " +
      "mirror — the fix must not overcorrect and break live-first",
    async () => {
      const LIVE_MARKER = "LIVE_MARKER_D02_2A_7C21";
      // A stale disk sentinel that can never appear in the live mirror.
      await snapshot.write(TASK, { cols: 80, rows: 24, data: "STALE_DISK_SENTINEL_D02_2A" });
      const a = newMgr("6.0.0");
      a.mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
      a.lastPty().__emit(`${LIVE_MARKER}\r\n`);
      await delay(120);
      // Same manager owns the live pty → spawn() is idempotent, mirror kept.
      expect(a.mgr.get(TASK)).toBeDefined();
      const ws = makeWs();
      buildWsHandlers(
        makeRealCtx({
          ptyManager: a.mgr,
          expectedTerminalVersion: "6.0.0",
          task: makeTask({ taskId: TASK, state: "active" }),
        }),
      ).onOpen?.({} as Event, ws as never);
      await awaitReplay(ws);
      const frame = replayFrame(ws);
      expect(frame).toBeDefined();
      expect(
        (frame!.data as string).includes(LIVE_MARKER),
        "live mirror content must be replayed when a live pty exists",
      ).toBe(true);
      expect(
        (frame!.data as string).includes("STALE_DISK_SENTINEL"),
        "the stale disk snapshot must NOT be served over the live mirror",
      ).toBe(false);
    },
  );

  // GUARD 2(b) — done/launch_failed replay-only branch still reads disk.
  it(
    "GUARD 2b (stays GREEN): the done/launch_failed replay-only branch " +
      "still reads the disk snapshot (unchanged by the fix)",
    async () => {
      const DONE_MARKER = "DONE_MARKER_D02_2B_44E9";
      await snapshot.write(TASK, { cols: 80, rows: 24, data: `cells ${DONE_MARKER}` });
      const { mgr } = newMgr("6.0.0"); // present but unused beyond disk read
      const ws = makeWs();
      buildWsHandlers(
        makeRealCtx({
          ptyManager: mgr,
          expectedTerminalVersion: undefined, // any-version accept
          task: makeTask({ taskId: TASK, state: "done" }),
        }),
      ).onOpen?.({} as Event, ws as never);
      await awaitReplay(ws);

      const frame = replayFrame(ws);
      expect(frame, "replay-only branch must emit the disk snapshot").toBeDefined();
      expect((frame!.data as string).includes(DONE_MARKER)).toBe(true);
      expect(ws.close).toHaveBeenCalledWith(1000);
    },
  );

  // GUARD 2(c) — the resolve/replay path never disposes the mirror (rule 21).
  it(
    "GUARD 2c (pins the fix): the WS-attach resolve/replay path never calls " +
      "HeadlessMirror.dispose() (CLAUDE.md DO-NOT rule 21)",
    async () => {
      const MARKER = "HIST_MARKER_D02_2C_B8D0";
      const a = newMgr("6.0.0");
      a.mgr.spawn(TASK, { cwd: process.cwd(), shell: "bash" });
      a.lastPty().__emit(`${MARKER}\r\n`);
      await delay(120);
      await a.mgr.flushMirrorSnapshot(TASK);
      await a.mgr.kill(TASK);
      await delay(120);
      const diskVersion = (await snapshot.read(TASK))!.terminalVersion;
      // Spy AFTER process A's teardown so kill()/cleanup disposals do not
      // count — assert only about the re-attach resolve/replay path.
      const disposeSpy = vi.spyOn(HeadlessMirror.prototype, "dispose");
      const b = newMgr(diskVersion);
      const ws = makeWs();
      buildWsHandlers(
        makeRealCtx({
          ptyManager: b.mgr,
          expectedTerminalVersion: diskVersion,
          task: makeTask({ taskId: TASK, state: "active" }),
        }),
      ).onOpen?.({} as Event, ws as never);
      await awaitReplay(ws);
      expect(
        disposeSpy,
        "the attach resolve/replay path must not dispose the mirror",
      ).not.toHaveBeenCalled();
    },
  );
});
