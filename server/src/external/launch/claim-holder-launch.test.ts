/*
 * FR-04.22 (V5, iterate-2026-09-03-claim-holder-launch) — the claim HOLDER
 * can launch; everyone else is refused, and the refusal is proved against a
 * webui process that has persisted NOTHING since the claim was written to
 * disk (a store freshly loaded from a file that already has the claim on it
 * would pass unconditionally and prove nothing — see routes.test.ts's own
 * "POST /launch returns 409 task_claimed" test, which is exactly that shape
 * and is NOT a regression guard for this bug).
 *
 * Repro shape: two SdkSessionsStore instances share the SAME on-disk file
 * (`sharedDeps`) — `appStore` is wired into the Hono app under test (stands
 * in for the long-running webui process); `daemonStore` stands in for the
 * leadwright daemon, a separate process claiming the task through its own
 * store instance + its own persist(). `appStore` never touches disk again
 * after its initial task creation — exactly the "idle daemon, no browser
 * open" case the spec calls out as the normal case, not an edge case.
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync, rmSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { SdkSessionsStore, type SdkSessionsStoreDeps } from "../../core/sdk-sessions-store.js";
import { SessionWatcher } from "../../core/session-watcher.js";
import { createExternalRoutes } from "../routes.js";
import { CLAIM_LAUNCH_WINDOW_MS } from "./claim-holder-gate.js";

/**
 * Unlike routes.test.ts's inMemoryDeps (a single-store harness that needs no
 * cross-instance coordination), THIS file puts two store instances on the
 * same fake file to stand in for two real OS processes — so it must also
 * fake the two things persist()'s F08 3-way merge needs a real `lock` for:
 * an in-memory mutex (FIFO, keyed by the whole store since there's only one
 * path in these tests) and a map-based `rename`. Without both, `persist()`
 * takes its no-lock "write memory directly" fallback (sdk-sessions-store.ts)
 * and skips the re-read-and-merge entirely — silently proving nothing about
 * trap #1 (baseline refresh) despite the test appearing to exercise it.
 */
function sharedDeps(): SdkSessionsStoreDeps {
  const files = new Map<string, string>();
  const existing = new Set<string>();
  let lockChain: Promise<void> = Promise.resolve();
  return {
    readFile: async (p) => {
      if (!files.has(p)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return files.get(p)!;
    },
    writeFile: async (p, data) => { files.set(p, data); existing.add(p); },
    existsSync: (p) => existing.has(p),
    mkdirSync: (p) => { existing.add(p); },
    ensureFile: (p) => { if (!files.has(p)) files.set(p, ""); existing.add(p); },
    lock: async () => {
      const prev = lockChain;
      let release!: () => void;
      lockChain = new Promise((r) => { release = r; });
      await prev;
      return async () => { release(); };
    },
    rename: async (from, to) => {
      if (!files.has(from)) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      files.set(to, files.get(from)!);
      files.delete(from);
      existing.add(to);
    },
  };
}

describe("POST /launch — claim holder gate (FR-04.22/V5)", () => {
  let app: Hono;
  let appStore: SdkSessionsStore;
  let daemonStore: SdkSessionsStore;
  let sharedFileDeps: SdkSessionsStoreDeps;
  let projectsDir: string;
  let taskId: string;

  beforeEach(async () => {
    projectsDir = mkdtempSync(path.join(tmpdir(), "claim-holder-launch-"));
    const deps = sharedDeps();
    sharedFileDeps = deps;

    appStore = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await appStore.load();

    const watcher = new SessionWatcher({ projectsDir });
    app = new Hono();
    app.route("/", createExternalRoutes({ store: appStore, watcher, ptyManager: { get: () => undefined } }));

    const create = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "claim-holder-launch", cwd: "/tmp" }),
    });
    const { task } = await create.json() as { task: { taskId: string } };
    taskId = task.taskId;

    // The leadwright daemon: a SEPARATE store instance over the SAME file.
    daemonStore = new SdkSessionsStore("/store/sdk-sessions.json", deps);
    await daemonStore.load();
  });

  it("[AC a] refuses launch when the webui process is stale — a claim written by a foreign store it never persisted", async () => {
    daemonStore.patch(taskId, {
      claimToken: "tok-daemon",
      claimedBy: "lead-7",
      claimedAt: new Date().toISOString(),
    });
    await daemonStore.persist();

    // Sanity: appStore's OWN in-memory copy is still stale — this is the
    // exact condition the fix must overcome, not a setup we control past.
    expect(appStore.get(taskId)?.claimToken).toBeUndefined();

    const launch = await app.request(`/api/external/tasks/${taskId}/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "new-plain" }),
    });
    expect(launch.status).toBe(409);
    const err = await launch.json() as { error: string; claimedBy?: string };
    expect(err.error).toBe("task_claimed");
    expect(err.claimedBy).toBe("lead-7");
  });

  it("[AC b] a launch bearing the current claimToken succeeds", async () => {
    daemonStore.patch(taskId, {
      claimToken: "tok-daemon",
      claimedBy: "lead-7",
      claimedAt: new Date().toISOString(),
    });
    await daemonStore.persist();

    const launch = await app.request(`/api/external/tasks/${taskId}/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "new-plain", claimToken: "tok-daemon" }),
    });
    expect(launch.status).toBe(200);
  });

  it("[AC b] a launch bearing a foreign or absent token is refused", async () => {
    daemonStore.patch(taskId, {
      claimToken: "tok-daemon",
      claimedBy: "lead-7",
      claimedAt: new Date().toISOString(),
    });
    await daemonStore.persist();

    const wrongToken = await app.request(`/api/external/tasks/${taskId}/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "new-plain", claimToken: "tok-someone-else" }),
    });
    expect(wrongToken.status).toBe(409);
    const wrongBody = await wrongToken.json() as { claimExpired?: boolean };
    expect(wrongBody.claimExpired).toBeUndefined();

    const noToken = await app.request(`/api/external/tasks/${taskId}/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "new-plain" }),
    });
    expect(noToken.status).toBe(409);
  });

  it("[AC c] a restart by the holder succeeds", async () => {
    daemonStore.patch(taskId, {
      claimToken: "tok-daemon",
      claimedBy: "lead-7",
      claimedAt: new Date().toISOString(),
    });
    await daemonStore.persist();

    const first = await app.request(`/api/external/tasks/${taskId}/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "new-plain", claimToken: "tok-daemon" }),
    });
    expect(first.status).toBe(200);

    // Restart — same holder, same still-current claim.
    const second = await app.request(`/api/external/tasks/${taskId}/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resume: true, claimToken: "tok-daemon" }),
    });
    expect(second.status).toBe(200);
  });

  it("[AC d] a claim older than the launch window is refused even with the right token, distinguishably from a foreign claim", async () => {
    const staleClaimedAt = new Date(Date.now() - (CLAIM_LAUNCH_WINDOW_MS + 60_000)).toISOString();
    daemonStore.patch(taskId, {
      claimToken: "tok-daemon",
      claimedBy: "lead-7",
      claimedAt: staleClaimedAt,
    });
    await daemonStore.persist();

    const launch = await app.request(`/api/external/tasks/${taskId}/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "new-plain", claimToken: "tok-daemon" }),
    });
    expect(launch.status).toBe(409);
    const err = await launch.json() as { error: string; claimExpired?: boolean };
    expect(err.error).toBe("task_claimed");
    expect(err.claimExpired).toBe(true); // distinguishable from a foreign-token 409 (no claimExpired field)
  });

  it("[AC e] baseline is refreshed with the row — a subsequent appStore persist() does not resurrect a released claim", async () => {
    daemonStore.patch(taskId, {
      claimToken: "tok-daemon",
      claimedBy: "lead-7",
      claimedAt: new Date().toISOString(),
    });
    await daemonStore.persist();

    const holderLaunch = await app.request(`/api/external/tasks/${taskId}/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actionId: "new-plain", claimToken: "tok-daemon" }),
    });
    expect(holderLaunch.status).toBe(200); // appStore's row+baseline refreshed here

    // The daemon releases the claim after the holder's launch went through.
    await daemonStore.refreshRowFromDisk(taskId);
    daemonStore.patch(taskId, { claimToken: undefined, claimedBy: undefined, claimedAt: undefined });
    await daemonStore.persist();

    // Some later, unrelated appStore persist (e.g. a title edit) — must NOT
    // write the now-released claimToken back to disk (trap #1, proven
    // end-to-end through the route rather than the store directly).
    appStore.patch(taskId, { title: "renamed-after-release" });
    await appStore.persist();

    // Read the ACTUAL on-disk state through a third, untouched store
    // instance — proves it end to end, not just appStore's own memory.
    const verifier = new SdkSessionsStore("/store/sdk-sessions.json", sharedFileDeps);
    await verifier.load();
    expect(verifier.get(taskId)?.claimToken).toBeUndefined();
    expect(verifier.get(taskId)?.title).toBe("renamed-after-release");
  });

  afterEach(() => {
    try { rmSync(projectsDir, { recursive: true, force: true }); } catch { /* ignore */ }
  });
});
