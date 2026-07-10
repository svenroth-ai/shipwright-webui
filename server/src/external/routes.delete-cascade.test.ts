/*
 * routes.delete-cascade.test.ts — Iterate C (ADR-087, MEDIUM-B1 fix) +
 * D01 review-round RED guard (suspended-flush resurrection race).
 *
 * DELETE /api/external/tasks/:id MUST cascade-clear the scrollback files and
 * the cell-state snapshot (both may hold secrets — the task delete is the
 * authoritative privacy boundary). The real-ConPTY teardown guard (Guard 1)
 * lives in delete-cascade-pty-teardown.test.ts and the SnapshotStore.clear()
 * fence (F05) in snapshot-clear-fence.test.ts — split out to keep every test
 * file <= 300 LOC (Stop-gate).
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
        scrollbackClearBestEffort: async (taskId) => { scrollbackCalls.push(taskId); },
        snapshotClearBestEffort: async (taskId) => { snapshotCalls.push(taskId); },
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
    const del = await app.request(`/api/external/tasks/${taskId}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    expect(scrollbackCalls).toEqual([taskId]);
    expect(snapshotCalls).toEqual([taskId]);
  });

  it("succeeds even when snapshot cleanup throws (best-effort)", async () => {
    app = new Hono();
    app.route(
      "/",
      createExternalRoutes({
        store,
        watcher: new SessionWatcher({ projectsDir: "/tmp/projects" }),
        ptyManager: { get: () => undefined },
        scrollbackClearBestEffort: async () => {},
        snapshotClearBestEffort: async () => { throw new Error("simulated EACCES"); },
      }),
    );
    const taskId = await createTask("t-fail-snapshot");
    const del = await app.request(`/api/external/tasks/${taskId}`, { method: "DELETE" });
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
        scrollbackClearBestEffort: async (taskId) => { scrollbackCalls.push(taskId); },
        // snapshotClearBestEffort intentionally omitted.
      }),
    );
    const taskId = await createTask("t-no-snapshot-dep");
    const del = await app.request(`/api/external/tasks/${taskId}`, { method: "DELETE" });
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
// D01 review-round — RED guard for the "suspended-flush-across-delete"
// resurrection race (MUST-NOT-MODIFY, author != fixer). In the documented F01
// scenario a WS-onClose flushMirrorSnapshot captures `entry` then parks at
// serializeStable BEFORE enqueuing its write; the awaited DELETE kill runs
// finalize -> releaseQueue (queue empty -> DELETED) then clear() (queue gone
// -> F05 fence is a no-op -> unlink). The flush then resumes and its write
// creates a FRESH queue -> <taskId>.snapshot is resurrected after the wipe.
//
// Determinism: gate the live mirror.serializeStable (test-only monkeypatch, no
// production edit) so the flush is provably parked while the real kill+clear
// run; release afterwards. Fixer seam: re-check entry liveness (or a post-clear
// tombstone) INSIDE flushMirrorSnapshot before its write — no new test hook.
// Evidence: Spec/audits/2026-07-10-webui-deep-audit.md § F01 (residual).
// ---------------------------------------------------------------------------

describe("DELETE /tasks/:id — suspended-flush resurrection race (D01 review RED guard)", () => {
  let dir: string;
  let scrollbackStore: ScrollbackStore;
  let snapshotStore: SnapshotStore;
  let ptyManager: PtyManager;
  let capturedPty: (PtyHandleApi & { pid?: number }) | null;
  let killTaskId = "";

  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
  const SECRET = `SECRET-${Math.random().toString(16).slice(2)}-MARKER`;
  const shell = process.platform === "win32" ? "cmd.exe" : "bash";

  async function exists(p: string): Promise<boolean> {
    try { await fsp.stat(p); return true; } catch { return false; }
  }

  beforeEach(async () => {
    dir = await fsp.mkdtemp(path.join(os.tmpdir(), "d01-race-"));
    scrollbackStore = new ScrollbackStore(dir, { maxBytesPerTask: 5_000_000 });
    await scrollbackStore.init();
    snapshotStore = new SnapshotStore(dir);
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
      idleTimeoutMs: 3_600_000,
    });
  });

  afterEach(async () => {
    // kill() is async (D01/F01) — await it so teardown settles before rm.
    try { if (killTaskId) await ptyManager.kill(killTaskId); } catch { /* best-effort */ }
    const pid = capturedPty?.pid;
    if (pid) { try { process.kill(pid, 0); process.kill(pid); } catch { /* dead */ } }
    await sleep(150);
    try { await fsp.rm(dir, { recursive: true, force: true }); } catch { /* best-effort */ }
    killTaskId = "";
  });

  it("a flushMirrorSnapshot parked at serializeStable must not re-create <taskId>.snapshot after kill+clear", async () => {
    const store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
    await store.load();
    const watcher = new SessionWatcher({ projectsDir: "/tmp/projects" });
    const task = store.create({ title: "secret", cwd: dir, pluginDirs: [] });
    killTaskId = task.taskId;
    ptyManager.spawn(task.taskId, { cwd: dir, shell });
    const logPath = path.join(dir, `${task.taskId}.log`);
    const snapPath = path.join(dir, `${task.taskId}.snapshot`);

    // Drive the secret into the live mirror; wait until scrollback has it.
    capturedPty!.write(`echo ${SECRET}\r`);
    const deadline = Date.now() + 8000;
    while (Date.now() < deadline) {
      if (await exists(logPath) && (await fsp.readFile(logPath, "utf8")).includes(SECRET)) break;
      await sleep(100);
    }

    // Gate the live mirror.serializeStable so the flush parks BEFORE it enqueues
    // its write. Pre-capture the secret-bearing payload (mirror alive now;
    // disposed by kill's finalize before the flush resumes).
    const internal = ptyManager as unknown as {
      entries: Map<string, {
        mirror: { serializeStable: () => Promise<string>; dimensions: { cols: number; rows: number } } | null;
      }>;
    };
    const mirror = internal.entries.get(task.taskId)?.mirror;
    if (!mirror) throw new Error("expected a live headless mirror for the task");
    const realSerialize = mirror.serializeStable.bind(mirror);
    const secretStable = await realSerialize();
    let releaseFlush: () => void = () => {};
    const flushGate = new Promise<void>((r) => { releaseFlush = r; });
    let calls = 0;
    mirror.serializeStable = async (): Promise<string> => {
      calls += 1;
      if (calls === 1) { await flushGate; return secretStable; } // the flush — parked
      return realSerialize(); // the kill-finalize serialize — passes through
    };

    // (1) WS onClose fires the fire-and-forget flush; it parks at the gate.
    const flushP = ptyManager.flushMirrorSnapshot(task.taskId);
    await sleep(0);

    // (2)+(3) REAL DELETE handler: awaited kill (finalize writes + releaseQueue
    // DELETES the queue + mirror disposed) then clear() (queue gone -> fence
    // no-op -> unlink).
    const ptyDep = {
      get: (id: string) => ptyManager.get(id),
      kill: (id: string) => ptyManager.kill(id),
      peekTerminalText: (id: string) => ptyManager.peekTerminalText(id),
    };
    const app = new Hono();
    app.route("/", createExternalRoutes({
      store,
      watcher,
      ptyManager: ptyDep as unknown as Parameters<typeof createExternalRoutes>[0]["ptyManager"],
      scrollbackClearBestEffort: (id) => scrollbackStore.clearBestEffort(id),
      snapshotClearBestEffort: (id) => snapshotStore.clearBestEffort(id),
    }));
    const del = await app.request(`/api/external/tasks/${task.taskId}`, { method: "DELETE" });
    expect(del.status).toBe(200);
    // The privacy wipe has completed — snapshot is gone at this point.
    expect(await exists(snapPath)).toBe(false);

    // (4) The suspended flush now resumes and attempts its write.
    releaseFlush();
    await flushP;
    await sleep(50);

    const orphanTmps = (await fsp.readdir(dir)).filter((n) =>
      n.startsWith(`${task.taskId}.snapshot.tmp-`));
    const snapshotResurrected = await exists(snapPath);
    expect(snapshotResurrected).toBe(false);
    expect(orphanTmps).toEqual([]);
    await sleep(200); // …and STAYS absent.
    expect(await exists(snapPath)).toBe(false);
  }, 30000);
});
