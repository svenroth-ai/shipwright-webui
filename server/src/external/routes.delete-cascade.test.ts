/*
 * routes.delete-cascade.test.ts — Iterate C (ADR-087, MEDIUM-B1 fix).
 *
 * DELETE /api/external/tasks/:id MUST cascade-clear BOTH:
 *   - scrollback files (`<taskId>.log` + `<taskId>.log.1`) via
 *     `scrollbackClearBestEffort` (existing behavior).
 *   - cell-state snapshot file (`<taskId>.snapshot`) via
 *     `snapshotClearBestEffort` (NEW in Iterate C).
 *
 * Why this matters: snapshots capture rendered terminal cell state and
 * may contain secrets (env vars, file content, prompt history). The
 * 24-h TTL is a backstop — the task delete is the authoritative
 * privacy boundary, so the snapshot file MUST go with the task.
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

describe("DELETE /tasks/:id — cascade cleanup (Iterate C MEDIUM-B1)", () => {
  let app: Hono;
  let store: SdkSessionsStore;
  let scrollbackCalls: string[];
  let snapshotCalls: string[];

  beforeEach(async () => {
    store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
    await store.load();
    const watcher = new SessionWatcher({ projectsDir: "/tmp/projects" });
    scrollbackCalls = [];
    snapshotCalls = [];
    app = new Hono();
    app.route(
      "/",
      createExternalRoutes({
        store,
        watcher,
        ptyManager: { get: () => undefined },
        scrollbackClearBestEffort: async (taskId) => {
          scrollbackCalls.push(taskId);
        },
        snapshotClearBestEffort: async (taskId) => {
          snapshotCalls.push(taskId);
        },
      }),
    );
  });

  async function createTask(title: string): Promise<string> {
    const res = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title, cwd: "/tmp" }),
    });
    const j = (await res.json()) as { task: { taskId: string } };
    return j.task.taskId;
  }

  it("invokes BOTH scrollbackClearBestEffort and snapshotClearBestEffort", async () => {
    const taskId = await createTask("t-cascade");
    const del = await app.request(`/api/external/tasks/${taskId}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(200);
    expect(scrollbackCalls).toEqual([taskId]);
    expect(snapshotCalls).toEqual([taskId]);
  });

  it("succeeds even when snapshot cleanup throws (best-effort)", async () => {
    // Override the snapshot dep to throw.
    app = new Hono();
    app.route(
      "/",
      createExternalRoutes({
        store,
        watcher: new SessionWatcher({ projectsDir: "/tmp/projects" }),
        ptyManager: { get: () => undefined },
        scrollbackClearBestEffort: async () => {},
        snapshotClearBestEffort: async () => {
          throw new Error("simulated EACCES");
        },
      }),
    );
    const taskId = await createTask("t-fail-snapshot");
    const del = await app.request(`/api/external/tasks/${taskId}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(200);
  });

  it("still works when only scrollback dep is wired (snapshot dep omitted)", async () => {
    app = new Hono();
    app.route(
      "/",
      createExternalRoutes({
        store,
        watcher: new SessionWatcher({ projectsDir: "/tmp/projects" }),
        ptyManager: { get: () => undefined },
        scrollbackClearBestEffort: async (taskId) => {
          scrollbackCalls.push(taskId);
        },
        // snapshotClearBestEffort intentionally omitted.
      }),
    );
    const taskId = await createTask("t-no-snapshot-dep");
    const del = await app.request(`/api/external/tasks/${taskId}`, {
      method: "DELETE",
    });
    expect(del.status).toBe(200);
    expect(scrollbackCalls).toEqual([taskId]);
  });

  it("returns 404 + does NOT invoke the cascade for an unknown task", async () => {
    const del = await app.request(
      "/api/external/tasks/00000000-0000-0000-0000-000000000000",
      { method: "DELETE" },
    );
    expect(del.status).toBe(404);
    expect(scrollbackCalls).toEqual([]);
    expect(snapshotCalls).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// D01 / F01 Guard 1 — independent RED integration guard with a REAL ConPTY
// (MUST-NOT-MODIFY, author != fixer).
//
// Full production stack: real PtyManager (real @lydell/node-pty shell) with
// the headless mirror ON, a real ScrollbackStore + SnapshotStore in a fresh
// temp dir, and the REAL lifecycle DELETE handler (createExternalRoutes). A
// unique secret is driven into BOTH the scrollback `.log` and the mirror
// snapshot, the task is DELETEd, then — past the last-detach flush and one
// transcript-poll tick — the `.log`, `.snapshot`, and `.snapshot.tmp-*`
// artifacts must be absent AND STAY absent, and the OS child shell must be
// dead. On pre-fix code the DELETE never kills the pty, so the last-detach
// flushMirrorSnapshot re-writes `<taskId>.snapshot` after the wipe and the
// shell stays alive → RED.
//
// Seam the fixer must add: `ptyManager.kill(taskId)` on the DELETE-handler
// dep (see routes.test.ts Guard 2). Combined with the F05 clear() fence,
// this guard goes GREEN.
//
// Evidence: Spec/audits/2026-07-10-webui-deep-audit.md § F01.
// ---------------------------------------------------------------------------

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
    try {
      if (killTaskId) ptyManager.kill(killTaskId);
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

// ---------------------------------------------------------------------------
// D01 / F05 Guard 2 (queue fence) — RED regression guard
// (MUST-NOT-MODIFY, author != fixer).
//
// SnapshotStore.clear() MUST fence the per-task write queue: a
// flushMirrorSnapshot write enqueued BEFORE clear() must NOT resurrect the
// snapshot after clear() resolves. On pre-fix code clear() unlinks FIRST and
// only awaits onIdle for Map hygiene (and early-returns on ENOENT before ever
// touching the queue), so an in-flight tmp->final rename lands the
// secret-bearing file AFTER the privacy wipe. The gate is released on a timer
// (not gated on clear()) so a correct fence-first fix cannot deadlock.
//
// Uses the store's existing SnapshotStoreOpts.renameFn seam (no new
// production hook required). Homed here (not in the baselined
// snapshot-store.test.ts) alongside the DELETE-cascade privacy guards.
//
// Evidence: Spec/audits/2026-07-10-webui-deep-audit.md § F05 (CASE A + B).
// ---------------------------------------------------------------------------

describe("SnapshotStore.clear() — in-flight write fence (D01/F05 RED guard)", () => {
  const FENCE_UUID = "11111111-2222-3333-4444-555555555555";
  const sleep = (ms: number): Promise<void> =>
    new Promise((r) => setTimeout(r, ms));
  let fenceDir: string;

  beforeEach(async () => {
    fenceDir = await fsp.mkdtemp(path.join(os.tmpdir(), "d01-f05-"));
  });
  afterEach(async () => {
    try {
      await fsp.rm(fenceDir, { recursive: true, force: true });
    } catch {
      /* best-effort */
    }
  });

  it("does not resurrect the snapshot when a write is in flight AND a file already exists (F05 CASE A)", async () => {
    let renameCount = 0;
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((res) => {
      releaseGate = res;
    });
    const store = new SnapshotStore(fenceDir, {
      renameFn: async (from, to) => {
        renameCount += 1;
        // Hold the SECOND write's rename (the in-flight flush) at the gate.
        if (renameCount === 2) await gate;
        await fsp.rename(from, to);
      },
    });
    await store.init();

    // A snapshot already on disk — the artifact the DELETE cascade must wipe.
    await store.write(FENCE_UUID, { cols: 80, rows: 24, data: "OLD-SECRET" });
    // A last-detach flushMirrorSnapshot write, still in flight when clear runs.
    const inFlight = store.write(FENCE_UUID, {
      cols: 80,
      rows: 24,
      data: "SECRET-IN-FLIGHT",
    });
    await sleep(50); // 2nd write's tmp is written; its rename is gated.

    // The in-flight rename lands shortly after — models the flush completing
    // concurrently with / just after the delete. Scheduled BEFORE the clear()
    // await so a fence-first fix that waits on the queue cannot deadlock.
    setTimeout(() => releaseGate(), 60);
    await store.clear(FENCE_UUID);
    await inFlight;

    // Privacy boundary: the snapshot MUST be gone after clear() resolves.
    expect(await store.has(FENCE_UUID)).toBe(false);
  });

  it("does not resurrect the snapshot when no file exists yet at clear() time (F05 CASE B / ENOENT early-return)", async () => {
    let releaseGate: () => void = () => {};
    const gate = new Promise<void>((res) => {
      releaseGate = res;
    });
    let firstRename = true;
    const store = new SnapshotStore(fenceDir, {
      renameFn: async (from, to) => {
        if (firstRename) {
          firstRename = false;
          await gate;
        }
        await fsp.rename(from, to);
      },
    });
    await store.init();

    // Only an in-flight write exists — no snapshot on disk yet, so pre-fix
    // clear() hits ENOENT and early-returns WITHOUT ever fencing the queue.
    const inFlight = store.write(FENCE_UUID, {
      cols: 80,
      rows: 24,
      data: "SECRET-IN-FLIGHT",
    });
    await sleep(50);

    setTimeout(() => releaseGate(), 60);
    await store.clear(FENCE_UUID);
    await inFlight;

    expect(await store.has(FENCE_UUID)).toBe(false);
  });
});
