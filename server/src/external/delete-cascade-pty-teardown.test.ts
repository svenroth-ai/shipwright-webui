/*
 * delete-cascade-pty-teardown.test.ts — D01 / F01 Guard 1 (MUST-NOT-MODIFY,
 * author != fixer).
 *
 * Independent RED integration guard with a REAL ConPTY. Full production stack:
 * real PtyManager (real @lydell/node-pty shell) with the headless mirror ON, a
 * real ScrollbackStore + SnapshotStore in a fresh temp dir, and the REAL
 * lifecycle DELETE handler (createExternalRoutes). A unique secret is driven
 * into BOTH the scrollback `.log` and the mirror snapshot, the task is DELETEd,
 * then — past the last-detach flush and one transcript-poll tick — the `.log`,
 * `.snapshot`, and `.snapshot.tmp-*` artifacts must be absent AND STAY absent,
 * and the OS child shell must be dead. On pre-fix code the DELETE never kills
 * the pty, so the last-detach flushMirrorSnapshot re-writes `<taskId>.snapshot`
 * after the wipe and the shell stays alive → RED.
 *
 * Seam the fixer added: `ptyManager.kill(taskId)` on the DELETE-handler dep
 * (see external/tasks/__tests__/routes.test.ts Guard 2). Combined with the F05
 * clear() fence, this guard is GREEN on the fix commit (b60090d).
 *
 * Split out of routes.delete-cascade.test.ts to keep every test file <= 300 LOC.
 *
 * Evidence: Spec/audits/2026-07-10-webui-deep-audit.md § F01.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import * as fsp from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";

import { SdkSessionsStore, type SdkSessionsStoreDeps } from "../core/sdk-sessions-store.js";
import { SessionWatcher } from "../core/session-watcher.js";
import { createExternalRoutes } from "./routes.js";
import { ScrollbackStore } from "../terminal/scrollback-store.js";
import { SnapshotStore } from "../terminal/snapshot-store.js";
import { PtyManager, type PtyHandleApi } from "../terminal/pty-manager.js";
import { createNodePtySpawnFn } from "../terminal/routes.js";

function inMemoryDeps(): SdkSessionsStoreDeps {
  const files = new Map<string, string>();
  const existing = new Set<string>();
  return {
    readFile: async (p) => {
      if (!files.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files.get(p)!;
    },
    writeFile: async (p, data) => { files.set(p, data); existing.add(p); },
    existsSync: (p) => existing.has(p),
    mkdirSync: (p) => { existing.add(p); },
    ensureFile: (p) => { if (!files.has(p)) files.set(p, ""); existing.add(p); },
  };
}

describe("DELETE /tasks/:id — live ConPTY teardown (D01/F01 Guard 1 RED)", () => {
  let scrollbackDir: string;
  let scrollbackStore: ScrollbackStore;
  let snapshotStore: SnapshotStore;
  let ptyManager: PtyManager;
  let capturedPty: (PtyHandleApi & { pid?: number }) | null;
  let killTaskId = "";

  const sleep = (ms: number): Promise<void> =>
    new Promise((r) => setTimeout(r, ms));
  const SECRET = `SECRET-${Math.random().toString(16).slice(2)}-MARKER`;
  const shell = process.platform === "win32" ? "cmd.exe" : "bash";

  async function fileExists(p: string): Promise<boolean> {
    try {
      await fsp.stat(p);
      return true;
    } catch {
      return false;
    }
  }
  function pidAlive(pid: number | undefined): boolean {
    if (!pid) return false;
    try {
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  beforeEach(async () => {
    scrollbackDir = await fsp.mkdtemp(path.join(os.tmpdir(), "d01-guard1-"));
    scrollbackStore = new ScrollbackStore(scrollbackDir, {
      maxBytesPerTask: 5_000_000,
    });
    await scrollbackStore.init();
    snapshotStore = new SnapshotStore(scrollbackDir);
    await snapshotStore.init();
    const realSpawn = await createNodePtySpawnFn();
    capturedPty = null;
    ptyManager = new PtyManager({
      spawn: (s, a, o) => {
        const h = realSpawn(s, a, o);
        capturedPty = h as PtyHandleApi & { pid?: number };
        return h;
      },
      scrollbackStore,
      snapshotStore,
      headlessMirrorEnabled: true,
      idleTimeoutMs: 3_600_000, // keep the idle reaper from killing mid-test
    });
  });

  afterEach(async () => {
    // kill() is async (D01/F01) — await it so teardown fully settles before
    // the temp-dir removal (avoids Windows EBUSY on a still-open handle).
    try {
      if (killTaskId) await ptyManager.kill(killTaskId);
    } catch {
      /* best-effort */
    }
    // Belt-and-braces: terminate the captured OS child directly so no shell
    // or conhost leaks even if the guard failed mid-way.
    const pid = capturedPty?.pid;
    if (pid && pidAlive(pid)) {
      try {
        process.kill(pid);
      } catch {
        /* best-effort */
      }
    }
    await sleep(150);
    try {
      await fsp.rm(scrollbackDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
    killTaskId = "";
  });

  it("kills the pty so log/snapshot/tmp stay wiped and the OS child dies", async () => {
    const store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
    await store.load();
    const watcher = new SessionWatcher({ projectsDir: "/tmp/projects" });
    const task = store.create({
      title: "secret-task",
      cwd: scrollbackDir,
      pluginDirs: [],
    });
    killTaskId = task.taskId;

    // Real ConPTY shell + headless mirror.
    ptyManager.spawn(task.taskId, { cwd: scrollbackDir, shell });
    const pid = capturedPty?.pid;
    expect(capturedPty).not.toBeNull();

    // Drive the secret into scrollback + mirror; wait until the `.log` has it.
    const logPath = path.join(scrollbackDir, `${task.taskId}.log`);
    const snapPath = path.join(scrollbackDir, `${task.taskId}.snapshot`);
    capturedPty!.write(`echo ${SECRET}\r`);
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (await fileExists(logPath)) {
        const raw = await fsp.readFile(logPath, "utf8");
        if (raw.includes(SECRET)) break;
      }
      await sleep(100);
    }
    // Persist the mirror snapshot (models the last-detach flush).
    await ptyManager.flushMirrorSnapshot(task.taskId);

    // Setup sanity — the secret is on disk in BOTH artifacts.
    expect(await fileExists(logPath)).toBe(true);
    expect((await fsp.readFile(logPath, "utf8")).includes(SECRET)).toBe(true);
    expect(await fileExists(snapPath)).toBe(true);

    // Wire the REAL DELETE cascade with a ptyManager that CAN kill.
    const ptyDep = {
      get: (id: string) => ptyManager.get(id),
      kill: (id: string) => ptyManager.kill(id),
      peekTerminalText: (id: string) => ptyManager.peekTerminalText(id),
    };
    const app = new Hono();
    app.route(
      "/",
      createExternalRoutes({
        store,
        watcher,
        ptyManager: ptyDep as unknown as Parameters<
          typeof createExternalRoutes
        >[0]["ptyManager"],
        scrollbackClearBestEffort: (id) => scrollbackStore.clearBestEffort(id),
        snapshotClearBestEffort: (id) => snapshotStore.clearBestEffort(id),
      }),
    );
    const del = await app.request(`/api/external/tasks/${task.taskId}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(200);

    // Model the two post-delete resurrection legs the audit describes:
    //   (1) last-detach flushMirrorSnapshot re-writes <taskId>.snapshot,
    //   (2) the still-live shell re-creates <taskId>.log on further output.
    await ptyManager.flushMirrorSnapshot(task.taskId);
    try {
      capturedPty!.write(`echo ${SECRET}_AGAIN\r`);
    } catch {
      /* pty is already dead on fixed code — expected */
    }
    await sleep(1200); // past the flush + one transcript-poll tick.

    const orphanTmps = (await fsp.readdir(scrollbackDir)).filter((n) =>
      n.startsWith(`${task.taskId}.snapshot.tmp-`),
    );
    const snapshotResurrected = await fileExists(snapPath);
    const logResurrected = await fileExists(logPath);
    const shellStillAlive = pidAlive(pid);

    expect(snapshotResurrected).toBe(false);
    expect(orphanTmps).toEqual([]);
    expect(logResurrected).toBe(false);
    expect(shellStillAlive).toBe(false);

    // …and STAY absent after a further tick (kill-finalize must not resurrect).
    await sleep(600);
    expect(await fileExists(snapPath)).toBe(false);
    expect(await fileExists(logPath)).toBe(false);
  }, 30000);
});
