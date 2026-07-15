/*
 * terminal-spawn-failure.test.ts —
 * iterate-2026-07-15-e2e-pty-spawn-cwd-267.
 *
 * Root cause (empirically established, NOT the reported "resource exhaustion"):
 * node-pty's Windows CreateProcess throws "Cannot create process, error code:
 * 267" (ERROR_DIRECTORY) when the spawn `cwd` no longer exists / is
 * delete-pending. A probe proved a valid cwd removed mid-run → 267, while 40
 * rapid spawns against a stable cwd all succeed. In the full E2E run, fixture
 * teardown removes a task's temp cwd while a prior pty still holds it; a later
 * spawn path hits the dead cwd and node-pty throws — previously UNCAUGHT at the
 * WS-upgrade spawn seam, which rejected the upgrade opaquely + logged the 267.
 *
 * These tests pin the robustness contract: a CreateProcess failure is converted
 * to a typed `PtySpawnFailedError` and every caller degrades CLEANLY.
 */

import { afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import type { MiddlewareHandler } from "hono";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  PtyManager,
  PtySpawnFailedError,
  type PtySpawnFn,
} from "./pty-manager.js";
import { createTerminalRoutes } from "./routes.js";
import type {
  SdkSessionsStore,
  ExternalTask,
} from "../core/sdk-sessions-store.js";

const TASK_ID = "11111111-2222-3333-4444-555555555555";

/** node-pty-style throw: the exact Windows message shape we observed. */
const throwingSpawn: PtySpawnFn = () => {
  throw new Error("Cannot create process, error code: 267");
};

function makeStore(cwd: string): SdkSessionsStore {
  const task: ExternalTask = {
    taskId: TASK_ID,
    sessionUuid: "00000000-0000-0000-0000-000000000001",
    cwd,
    pluginDirs: [],
    state: "active",
    title: "spawn-fail",
    projectId: "unassigned",
    createdAt: "2026-07-15T00:00:00.000Z",
    inbox: {
      pendingToolUseIds: [],
      dismissedToolUseIds: [],
      lastProcessedByteOffset: 0,
    },
    firstJsonlObservedAt: "2026-07-15T00:00:00.000Z",
  };
  return {
    get: (id: string) => (id === TASK_ID ? task : undefined),
    patch: () => {},
    persist: async () => {},
  } as unknown as SdkSessionsStore;
}

/**
 * Fake `upgradeWebSocket` that INVOKES the events factory synchronously and
 * surfaces a thrown upgrade-rejection as an HTTP response, so the deterministic
 * `app.request()` client can observe the rejection reason WITHOUT a real socket
 * (mirrors how the real @hono/node-ws rejects the HTTP Upgrade when the factory
 * throws — see routes.ts VALIDATION TIMING contract).
 */
function fakeUpgradeWebSocket(createEvents: (c: unknown) => unknown): MiddlewareHandler {
  return (async (c) => {
    try {
      createEvents(c);
      // Would-be successful upgrade.
      return c.body(null, 101);
    } catch (err) {
      return c.json({ upgradeRejected: (err as Error).message }, 400);
    }
  }) as MiddlewareHandler;
}

describe("iterate-2026-07-15 — pty CreateProcess failure is handled, never uncaught", () => {
  let realCwd = "";

  afterEach(() => {
    if (realCwd) {
      try {
        fs.rmSync(realCwd, { recursive: true, force: true });
      } catch {
        /* ignore */
      }
      realCwd = "";
    }
  });

  // --- AC-1: PtyManager.spawn typing + no leaked entry --------------------
  it("AC-1: spawn() wraps a node-pty throw in PtySpawnFailedError and leaves no entry", () => {
    const mgr = new PtyManager({ spawn: throwingSpawn });
    let caught: unknown;
    try {
      mgr.spawn(TASK_ID, { cwd: "/tmp/gone", shell: "bash" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PtySpawnFailedError);
    // Native error code is parsed off the message (267 = ERROR_DIRECTORY).
    expect((caught as PtySpawnFailedError).code).toBe(267);
    // No half-registered entry survives a failed spawn.
    expect(mgr.get(TASK_ID)).toBeUndefined();
  });

  it("AC-1b: a non-coded spawn throw still yields PtySpawnFailedError with code null", () => {
    const mgr = new PtyManager({
      spawn: () => {
        throw new Error("EPERM: operation not permitted");
      },
    });
    let caught: unknown;
    try {
      mgr.spawn(TASK_ID, { cwd: "/tmp/x", shell: "bash" });
    } catch (err) {
      caught = err;
    }
    expect(caught).toBeInstanceOf(PtySpawnFailedError);
    expect((caught as PtySpawnFailedError).code).toBeNull();
  });

  it("AC-1c: isLikelyCwdError is true for 267/ENOENT/ENOTDIR, false for other spawn failures", () => {
    const mk = (msg: string): PtySpawnFailedError => {
      try {
        new PtyManager({
          spawn: () => {
            throw new Error(msg);
          },
        }).spawn("t", { cwd: "/x", shell: "bash" });
      } catch (e) {
        return e as PtySpawnFailedError;
      }
      throw new Error("expected spawn to throw");
    };
    expect(mk("Cannot create process, error code: 267").isLikelyCwdError).toBe(true);
    expect(mk("spawn /bin/bash ENOENT").isLikelyCwdError).toBe(true);
    expect(mk("ENOTDIR: not a directory, uv_cwd").isLikelyCwdError).toBe(true);
    expect(mk("EMFILE: too many open files").isLikelyCwdError).toBe(false);
    expect(mk("EPERM: operation not permitted").isLikelyCwdError).toBe(false);
  });

  // --- AC-2: WS upgrade rejects cleanly, not an uncaught throw ------------
  it("AC-2: the WS upgrade converts a spawn failure into a deterministic task_cwd_unusable rejection", async () => {
    // cwd must EXIST so resolveTrustedCwd passes (existsSync/realpath) and the
    // failure lands on the spawn seam — exactly the TOCTOU / delete-pending path.
    realCwd = fs.mkdtempSync(path.join(os.tmpdir(), "spawnfail-ws-"));
    const app = new Hono();
    createTerminalRoutes({
      store: makeStore(realCwd),
      ptyManager: new PtyManager({ spawn: throwingSpawn, watchdogEnabled: false }),
      upgradeWebSocket: fakeUpgradeWebSocket as never,
      allowedOrigins: () => true,
      resolveShell: () => "bash",
    })(app);

    const res = await app.request(`/api/terminal/${TASK_ID}/ws`, {
      headers: { origin: "http://127.0.0.1" },
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { upgradeRejected?: string };
    expect(body.upgradeRejected).toBe("task_cwd_unusable");
  });

  // --- AC-3: prewarm route distinguishes spawn-failure from whitelist ----
  it("AC-3: POST /spawn returns 409 task_cwd_unusable when CreateProcess fails", async () => {
    realCwd = fs.mkdtempSync(path.join(os.tmpdir(), "spawnfail-prewarm-"));
    const app = new Hono();
    createTerminalRoutes({
      store: makeStore(realCwd),
      ptyManager: new PtyManager({ spawn: throwingSpawn, watchdogEnabled: false }),
      upgradeWebSocket: fakeUpgradeWebSocket as never,
      allowedOrigins: () => true,
      resolveShell: () => "bash",
    })(app);

    const res = await app.request(`/api/terminal/${TASK_ID}/spawn`, {
      method: "POST",
    });
    expect(res.status).toBe(409);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("task_cwd_unusable");
  });

  it("AC-3b: POST /spawn still returns 400 pty_spawn_rejected for a non-whitelisted shell", async () => {
    realCwd = fs.mkdtempSync(path.join(os.tmpdir(), "spawnfail-reject-"));
    const app = new Hono();
    createTerminalRoutes({
      store: makeStore(realCwd),
      // A whitelisted-shell spawnFn would be fine; the rejection happens BEFORE
      // spawnFn is called because `claude` is not on the allowlist.
      ptyManager: new PtyManager({ spawn: throwingSpawn, watchdogEnabled: false }),
      upgradeWebSocket: fakeUpgradeWebSocket as never,
      allowedOrigins: () => true,
      resolveShell: () => "claude",
    })(app);

    const res = await app.request(`/api/terminal/${TASK_ID}/spawn`, {
      method: "POST",
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("pty_spawn_rejected");
  });

  it("AC-3c: POST /spawn returns 500 pty_spawn_failed for a NON-cwd spawn failure (EMFILE), not task_cwd_unusable", async () => {
    realCwd = fs.mkdtempSync(path.join(os.tmpdir(), "spawnfail-emfile-"));
    const app = new Hono();
    createTerminalRoutes({
      store: makeStore(realCwd),
      ptyManager: new PtyManager({
        spawn: () => {
          throw new Error("posix_spawnp failed: EMFILE: too many open files");
        },
        watchdogEnabled: false,
      }),
      upgradeWebSocket: fakeUpgradeWebSocket as never,
      allowedOrigins: () => true,
      resolveShell: () => "bash",
    })(app);

    const res = await app.request(`/api/terminal/${TASK_ID}/spawn`, {
      method: "POST",
    });
    expect(res.status).toBe(500);
    const body = (await res.json()) as { error?: string };
    expect(body.error).toBe("pty_spawn_failed");
  });
});
