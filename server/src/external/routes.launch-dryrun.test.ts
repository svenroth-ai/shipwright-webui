/*
 * routes.launch-dryrun.test.ts — resume-cta-rework (2026-05-16) AC-3.
 *
 * The "Copy Resume command" ⋯-menu item needs the resume command
 * string but must NOT flip the task into `awaiting_external_start`.
 * POST /launch with `dryRun: true` builds + returns `commands` with
 * zero state mutation, and bypasses the `done` launch-guard (copying
 * a command is not a launch).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { mkdtempSync } from "node:fs";
import path from "node:path";
import { tmpdir } from "node:os";

import { SdkSessionsStore, type SdkSessionsStoreDeps } from "../core/sdk-sessions-store.js";
import { SessionWatcher } from "../core/session-watcher.js";
import { createExternalRoutes } from "./routes.js";

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

describe("AC-3 — POST /launch dryRun builds commands without mutating state", () => {
  let app: Hono;
  let store: SdkSessionsStore;
  let projectsDir: string;

  beforeEach(async () => {
    projectsDir = mkdtempSync(path.join(tmpdir(), "ac3-dryrun-"));
    store = new SdkSessionsStore("/store/sdk-sessions.json", inMemoryDeps());
    await store.load();
    const watcher = new SessionWatcher({ projectsDir });
    app = new Hono();
    app.route(
      "/",
      createExternalRoutes({
        store,
        watcher,
        ptyManager: { get: () => undefined },
      }),
    );
  });

  async function createTask(): Promise<{ taskId: string; sessionUuid: string }> {
    const res = await app.request("/api/external/tasks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ title: "dryrun-demo", cwd: "/tmp/whatever" }),
    });
    const json = (await res.json()) as {
      task: { taskId: string; sessionUuid: string };
    };
    return { taskId: json.task.taskId, sessionUuid: json.task.sessionUuid };
  }

  function postLaunch(taskId: string, body: Record<string, unknown>) {
    return app.request(`/api/external/tasks/${taskId}/launch`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("dryRun:true + resume:true → returns the --resume command", async () => {
    const { taskId, sessionUuid } = await createTask();
    const res = await postLaunch(taskId, { resume: true, dryRun: true });
    expect(res.status).toBe(200);
    const json = (await res.json()) as {
      commands: { powershell: string; cmd: string; posix: string };
    };
    expect(json.commands.powershell).toContain(`--resume '${sessionUuid}'`);
    expect(json.commands.posix).toContain(`--resume '${sessionUuid}'`);
  });

  it("dryRun:true does NOT mutate task state (no awaiting_external_start)", async () => {
    const { taskId } = await createTask();
    const stateBefore = store.get(taskId)!.state;
    await postLaunch(taskId, { resume: true, dryRun: true });
    expect(store.get(taskId)!.state).toBe(stateBefore);
    expect(store.get(taskId)!.state).not.toBe("awaiting_external_start");
    expect(store.get(taskId)!.launchedAt).toBeUndefined();
  });

  it("a normal (non-dryRun) launch DOES flip to awaiting_external_start (contrast)", async () => {
    const { taskId } = await createTask();
    await postLaunch(taskId, { resume: true });
    expect(store.get(taskId)!.state).toBe("awaiting_external_start");
  });

  it("dryRun:true bypasses the `done` launch-guard (copy is not a launch)", async () => {
    const { taskId, sessionUuid } = await createTask();
    store.patch(taskId, { state: "done" });
    const res = await postLaunch(taskId, { resume: true, dryRun: true });
    expect(res.status).toBe(200);
    const json = (await res.json()) as { commands: { powershell: string } };
    expect(json.commands.powershell).toContain(`--resume '${sessionUuid}'`);
    // dryRun must not have touched the terminal state.
    expect(store.get(taskId)!.state).toBe("done");
  });

  it("a normal launch on a `done` task is still rejected (409)", async () => {
    const { taskId } = await createTask();
    store.patch(taskId, { state: "done" });
    const res = await postLaunch(taskId, { resume: true });
    expect(res.status).toBe(409);
  });
});
